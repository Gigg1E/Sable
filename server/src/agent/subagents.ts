import { all, get, run } from '../db.js';
import { emit, onEvent } from '../events.js';
import { resolveModel } from '../llm/index.js';
import { notify } from '../push.js';
import { getSettings, type AgentProfile } from '../settings.js';
import { errorMessage, id, now, parseJson, truncate } from '../util.js';
import type { Preapproval } from './automation.js';
import { subagentSystemPrompt } from './prompt.js';
import type { ChatMessage } from '../llm/types.js';
import { activeRunFor, agentLoop, type LoopOutcome, enabledSubagents, interject, setDelegateDecorator, startRun } from './runner.js';
import { getTool, listTools, registerTool, type ToolDef } from './tools/registry.js';

/**
 * Sub-agents. The main agent hands off self-contained tasks, one or several at once, and either
 * waits for the results or lets them run in the background. A background job works like a watcher
 * on itself: when it finishes, its result is posted back into the chat and the main agent picks
 * it up. Every job's steps, text and result are saved and shown live in a card in the chat.
 */

export type JobStep =
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; summary: string; status?: string; preview?: string };

export interface Job {
  id: string;
  conversation_id: string;
  agent_id: string;
  agent_name: string;
  task: string;
  background: boolean;
  status: 'running' | 'done' | 'error' | 'cancelled';
  steps: JobStep[];
  result: string | null;
  model: string | null;
  /** How it ended: ran out of steps, forced to write a report, raw tool results attached. */
  outcome?: LoopOutcome | null;
  created_at: number;
  finished_at: number | null;
}

const MAX_PARALLEL = 6;
const controllers = new Map<string, AbortController>();

/** Always available: a general helper on the main model with the main agent's tools. */
function helperProfile(): AgentProfile {
  const s = getSettings();
  return {
    id: 'helper',
    name: 'Helper',
    description: 'General-purpose helper on the main model with the same tools as you (except delegating). Good for splitting up research or doing several independent things at once.',
    providerId: s.main.providerId,
    model: s.main.model,
    // Straight from the registry (mainTools() would describe delegate, which lists this profile).
    tools: listTools().filter((t) => t.name !== 'delegate' && (s.policies[t.name] ?? t.defaultPolicy) !== 'deny').map((t) => t.name),
    enabled: true,
    maxSteps: 15,
  };
}

function profiles(): AgentProfile[] {
  const subs = enabledSubagents();
  return subs.some((p) => p.id === 'helper') ? subs : [...subs, helperProfile()];
}

function rowToJob(r: Record<string, unknown>): Job {
  const { transcript: _t, ...rest } = r;
  return { ...(rest as unknown as Job), background: !!r.background, steps: parseJson<JobStep[]>(r.steps as string, []), outcome: parseJson<LoopOutcome | null>(r.outcome as string, null) };
}

/** Research agents need room: at least 30 steps when they can search or read the web. */
function stepLimit(profile: AgentProfile) {
  const research = profile.tools.some((t) => t === 'web_search' || t === 'web_fetch');
  return Math.max(profile.maxSteps ?? 15, research ? 30 : 0);
}

/** Keep the sub-agent's conversation so a stopped job can be continued (tool output trimmed). */
function saveTranscript(jid: string, messages: ChatMessage[]) {
  const slim = messages.map((m) => (m.role === 'tool' ? { ...m, content: truncate(String(m.content ?? ''), 12_000) } : m));
  let json = JSON.stringify(slim);
  if (json.length > 1_500_000) json = JSON.stringify(slim.slice(0, 1).concat(slim.slice(-60)));
  run('UPDATE agent_jobs SET transcript = ? WHERE id = ?', json, jid);
}
export function getJob(jid: string): Job | undefined {
  const r = get<Record<string, unknown>>('SELECT * FROM agent_jobs WHERE id = ?', jid);
  return r ? rowToJob(r) : undefined;
}
export function listJobs(conversationId?: string): Job[] {
  const rows = conversationId
    ? all<Record<string, unknown>>('SELECT * FROM agent_jobs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50', conversationId)
    : all<Record<string, unknown>>("SELECT * FROM agent_jobs WHERE status = 'running' OR created_at > ? ORDER BY created_at DESC LIMIT 50", now() - 86_400_000);
  return rows.map(rowToJob);
}

export function cancelJob(jid: string) {
  controllers.get(jid)?.abort();
  return controllers.has(jid);
}

/** Jobs can't survive a restart (their model call is gone). */
export function sweepJobs() {
  run("UPDATE agent_jobs SET status = 'error', result = COALESCE(result, 'Stopped: Sable restarted while this was running.'), finished_at = ? WHERE status = 'running'", now());
}

/** Run one job to completion, recording every step. Resolves with the result text; never throws. */
async function runJob(job: Job, profile: AgentProfile, opts: { runId: string; preapproved?: Preapproval | null; parentSignal?: AbortSignal; resume?: ChatMessage[] }): Promise<Job> {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  // A waited-on job stops with its parent run; a background job only stops when cancelled.
  const onParentAbort = () => controller.abort();
  opts.parentSignal?.addEventListener('abort', onParentAbort);

  const steps = job.steps;
  let dirty = false;
  let timer: NodeJS.Timeout | null = null;
  const save = (force = false) => {
    dirty = true;
    if (timer && !force) return;
    const flush = () => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      run('UPDATE agent_jobs SET steps = ? WHERE id = ?', JSON.stringify(steps.slice(-200)), job.id);
      emit({ type: 'job.update', conversationId: job.conversation_id, job: { ...job, steps: steps.slice(-200) } });
    };
    if (force) flush();
    else timer = setTimeout(flush, 350);
  };
  // The sub-agent's tool calls are reported on the event bus under this job's id.
  const off = onEvent((ev) => {
    if (ev.parentCallId !== job.id) return;
    if (ev.type === 'tool.start') steps.push({ k: 'tool', id: String(ev.callId), summary: String(ev.summary ?? ev.name) });
    else if (ev.type === 'tool.end' || ev.type === 'tool.waiting') {
      const st = steps.find((x): x is Extract<JobStep, { k: 'tool' }> => x.k === 'tool' && x.id === ev.callId);
      if (st) {
        st.status = ev.type === 'tool.waiting' ? 'waiting' : String(ev.status);
        if (ev.preview) st.preview = truncate(String(ev.preview), 300);
      }
    } else return;
    save();
  });

  try {
    const s = getSettings();
    const model = await resolveModel(profile.providerId, profile.model || (profile.providerId === s.main.providerId ? s.main.model : ''));
    job.model = model;
    run('UPDATE agent_jobs SET model = ? WHERE id = ?', model, job.id);
    const tools = profile.tools.map((n) => getTool(n)).filter((t): t is ToolDef => !!t && t.name !== 'delegate');
    const messages: ChatMessage[] = opts.resume ?? [{ role: 'user', content: job.task }];
    const outcome: LoopOutcome = {};
    job.outcome = null;
    let result: string;
    try {
      result = await agentLoop({
      runId: opts.runId,
      conversationId: job.conversation_id,
      agent: { id: profile.id, name: profile.name },
      providerId: profile.providerId,
      model,
      effort: profile.effort,
      temperature: profile.temperature,
      contextLength: profile.contextLength,
      system: subagentSystemPrompt(profile),
      messages,
      tools,
      maxSteps: stepLimit(profile),
      outcome,
      signal: controller.signal,
      persist: false,
      parentCallId: job.id,
      preapproved: opts.preapproved,
      progress: (text, kind) => {
        if (kind !== 'text' || !text) return;
        const last = steps[steps.length - 1];
        if (last?.k === 'text') last.text = (last.text + text).slice(-4000);
        else steps.push({ k: 'text', text });
        save();
      },
    });
    } finally {
      saveTranscript(job.id, messages);
      job.outcome = Object.keys(outcome).length ? outcome : null;
    }
    job.status = 'done';
    job.result = result || '(no reply)';
  } catch (err) {
    job.status = controller.signal.aborted ? 'cancelled' : 'error';
    job.result = controller.signal.aborted ? 'Cancelled.' : `Failed: ${errorMessage(err)}`;
  } finally {
    off();
    if (timer) clearTimeout(timer);
    opts.parentSignal?.removeEventListener('abort', onParentAbort);
    controllers.delete(job.id);
  }
  job.finished_at = now();
  run('UPDATE agent_jobs SET status = ?, result = ?, steps = ?, finished_at = ?, outcome = ? WHERE id = ?', job.status, job.result, JSON.stringify(steps.slice(-200)), job.finished_at, job.outcome ? JSON.stringify(job.outcome) : null, job.id);
  emit({ type: 'job.update', conversationId: job.conversation_id, job });
  return job;
}

function createJob(conversationId: string, profile: AgentProfile, task: string, background: boolean): Job {
  const job: Job = { id: id('job_'), conversation_id: conversationId, agent_id: profile.id, agent_name: profile.name, task, background, status: 'running', steps: [], result: null, model: null, created_at: now(), finished_at: null };
  run('INSERT INTO agent_jobs (id, conversation_id, agent_id, agent_name, task, background, status, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', job.id, conversationId, profile.id, profile.name, task, background ? 1 : 0, 'running', '[]', job.created_at);
  emit({ type: 'job.update', conversationId, job });
  return job;
}

/**
 * Continue a job that stopped (step limit, failure): same sub-agent, same conversation so far,
 * a fresh step budget. Runs in the background and reports back like any background job.
 */
export function continueJob(jid: string, note?: string): Job {
  const r = get<Record<string, unknown>>('SELECT * FROM agent_jobs WHERE id = ?', jid);
  if (!r) throw new Error('No sub-agent job with that id.');
  const job = rowToJob(r);
  if (job.status === 'running') throw new Error('That job is still running.');
  const profile = profiles().find((p) => p.id === job.agent_id);
  if (!profile) throw new Error(`The sub-agent "${job.agent_name}" is no longer available.`);
  const history = parseJson<ChatMessage[]>(r.transcript as string, []);
  const resume: ChatMessage[] = history.length ? history : [{ role: 'user', content: job.task }];
  resume.push({
    role: 'user',
    content: `Continue the task where you left off. Don't repeat work you already did; use what you found above.${note ? `\nExtra instruction: ${note}` : ''}`,
  });
  job.status = 'running';
  job.background = true;
  job.finished_at = null;
  run("UPDATE agent_jobs SET status = 'running', background = 1, finished_at = NULL WHERE id = ?", job.id);
  emit({ type: 'job.update', conversationId: job.conversation_id, job });
  void runJob(job, profile, { runId: job.id, resume }).then(reportBack);
  return job;
}

/** A background job finished: tell the user, and hand the result to the main agent in the same chat. */
function reportBack(job: Job) {
  const verb = job.status === 'done' ? 'finished' : job.status === 'cancelled' ? 'was cancelled' : 'failed';
  void notify({ title: `${job.agent_name} ${verb}`, body: truncate((job.result ?? '').replace(/\s+/g, ' '), 160), link: `/chat/${job.conversation_id}`, kind: 'agent' }).catch(() => {});
  if (job.status === 'cancelled') return;
  const stoppedNote = job.outcome?.stopped === 'limit' ? ' It stopped at its step limit; continue it (delegate with continue) if the result is incomplete.' : '';
  const msg = `[Sub-agent ${verb}: ${job.agent_name} · ${job.id}]\nTask: ${truncate(job.task, 600)}\n\nResult:\n${truncate(job.result ?? '', 30_000)}\n\n(This is the background job you started. Continue what the user asked with this result and tell them the outcome.${stoppedNote} If other jobs you started are still running, say what's still pending and stop; you'll be woken again.)`;
  try {
    if (activeRunFor(job.conversation_id)) interject(job.conversation_id, msg);
    else startRun(job.conversation_id, msg);
  } catch {
    interject(job.conversation_id, msg);
  }
}

registerTool({
  name: 'delegate',
  label: 'Delegate',
  group: 'Agents',
  description:
    'Hand self-contained tasks to sub-agents. One task: agent + task. Several at once: tasks (they run side by side, up to 6). Sub-agents can\'t see this conversation, so put every detail in each task. ' +
    'If a result says it stopped at its step limit, continue that job (continue: job id) instead of guessing the rest. Never fill gaps in a sub-agent\'s findings from your own memory: say what is missing, or continue the job. ' +
    'wait (default true): wait for the results, for things you need right now to answer. wait false: run in the background, for anything long (deep research, many pages, comparisons) or anything the user doesn\'t need to wait for. A background job is watched until it finishes; you are woken in this chat with its result, so after starting one, tell the user what\'s running and stop. Don\'t poll. The user sees each sub-agent\'s steps live in the chat.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Sub-agent id (for a single task)' },
      task: { type: 'string', description: 'Complete, self-contained instructions (for a single task)' },
      tasks: {
        type: 'array',
        description: 'Several tasks to run at the same time',
        items: { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' } }, required: ['task'] },
      },
      wait: { type: 'boolean', description: 'false = run in the background and report back when done (default true)' },
      continue: { type: 'string', description: 'Id of a stopped job (e.g. it hit its step limit) to continue where it left off, with a fresh step budget. Put any extra instruction in task. Runs in the background.' },
    },
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => {
    const list = Array.isArray(a.tasks) ? a.tasks : [{ agent: a.agent, task: a.task }];
    const names = [...new Set(list.map((t: { agent?: string }) => profiles().find((p) => p.id === (t.agent || 'helper'))?.name ?? t.agent ?? 'Helper'))];
    return `${a.wait === false ? 'Background: ' : ''}${list.length > 1 ? `${list.length} tasks (${names.join(', ')})` : `${names[0]}: ${truncate(String(list[0]?.task ?? ''), 90)}`}`;
  },
  async run(a, ctx) {
    if (a.continue) {
      const job = continueJob(String(a.continue), a.task ? String(a.task) : undefined);
      return {
        content: `Continuing ${job.agent_name} (${job.id}) in the background from where it stopped. Its result comes back to you in this chat; don't wait or poll.`,
        cards: [{ type: 'subagent', jobId: job.id, agent: job.agent_name, task: truncate(job.task, 300), background: true }],
      };
    }
    const list: { agent?: string; task?: string }[] = Array.isArray(a.tasks) && a.tasks.length ? a.tasks : [{ agent: a.agent, task: a.task }];
    if (list.length > MAX_PARALLEL) return `At most ${MAX_PARALLEL} tasks at once. Split the rest into a later call.`;
    const avail = profiles();
    const resolved: { profile: AgentProfile; task: string }[] = [];
    for (const t of list) {
      const profile = avail.find((p) => p.id === (t.agent || 'helper'));
      if (!profile) return `No sub-agent "${t.agent}". Available: ${avail.map((p) => p.id).join(', ')}.`;
      if (!String(t.task ?? '').trim()) return 'Each task needs instructions in task.';
      resolved.push({ profile, task: String(t.task) });
    }
    const background = a.wait === false;
    const preapproved = (activeRunFor(ctx.conversationId) as { preapproved?: Preapproval | null } | undefined)?.preapproved ?? null;
    const jobs = resolved.map(({ profile, task }) => ({ job: createJob(ctx.conversationId, profile, task, background), profile }));
    const cards = jobs.map(({ job }) => ({ type: 'subagent', jobId: job.id, agent: job.agent_name, task: truncate(job.task, 300), background }));

    if (background) {
      for (const { job, profile } of jobs) {
        // Its own run id, so its tool calls and approvals don't tie up the chat.
        void runJob(job, profile, { runId: job.id, preapproved }).then(reportBack);
      }
      return {
        content: `Started in the background: ${jobs.map(({ job }) => `${job.agent_name} (${job.id})`).join(', ')}. Each is watched until it finishes and its result comes back to you in this chat. Tell the user what's running; don't wait or poll.`,
        cards,
      };
    }

    ctx.progress?.(`${jobs.map(({ job }) => job.agent_name).join(', ')} working`, 'tool');
    const done = await Promise.all(jobs.map(({ job, profile }) => runJob(job, profile, { runId: ctx.runId, preapproved, parentSignal: ctx.signal })));
    if (ctx.signal.aborted) throw new Error('aborted');
    const content =
      done.length === 1
        ? done[0].result ?? ''
        : done.map((j) => `## ${j.agent_name} (${j.id}) — ${j.status}\nTask: ${truncate(j.task, 200)}\n\n${j.result}`).join('\n\n');
    return { content, cards };
  },
});

setDelegateDecorator((t) => {
  const subs = profiles();
  const ids = subs.map((s) => s.id);
  const agentProp = { type: 'string', enum: ids, description: 'Sub-agent id (default helper)' };
  return {
    ...t,
    description: `${t.description}\nAvailable sub-agents:\n${subs.map((s) => `- ${s.id} (${s.name}): ${s.description}`).join('\n')}`,
    parameters: {
      ...t.parameters,
      properties: {
        ...t.parameters.properties,
        agent: agentProp,
        tasks: { type: 'array', description: 'Several tasks to run at the same time', items: { type: 'object', properties: { agent: agentProp, task: { type: 'string' } }, required: ['task'] } },
      },
    },
  };
});
