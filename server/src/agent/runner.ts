import { all, get, run } from '../db.js';
import { connectedClients, emit } from '../events.js';
import { resolveModel, resolveProvider } from '../llm/index.js';
import type { AssistantMessage, ChatMessage, ToolCall } from '../llm/types.js';
import { notify } from '../push.js';
import { getSettings, type AgentProfile, type Effort } from '../settings.js';
import { errorMessage, id, now, parseJson, truncate } from '../util.js';
import { mainSystemPrompt, subagentSystemPrompt } from './prompt.js';
import { attachmentForModel, attachmentInfo, readImage } from '../uploads.js';
import { decide, requestApproval } from './sentinel.js';
import { getTool, listTools, registerTool, toSpec, validateArgs, type Card, type ToolContext, type ToolDef, type ToolPreview } from './tools/registry.js';

// ───────────────────────── Active runs ─────────────────────────

interface ActiveRun {
  runId: string;
  conversationId: string;
  controller: AbortController;
}
const active = new Map<string, ActiveRun>();

export function activeRunFor(conversationId: string): ActiveRun | undefined {
  for (const r of active.values()) if (r.conversationId === conversationId) return r;
}
export function activeRuns() {
  return [...active.values()].map((r) => ({ runId: r.runId, conversationId: r.conversationId }));
}
export function cancelRun(runId: string) {
  active.get(runId)?.controller.abort();
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ───────────────────────── Persistence helpers ─────────────────────────

export interface MessageRow {
  id: string;
  conversation_id: string;
  run_id: string | null;
  role: 'user' | 'assistant' | 'tool' | 'error';
  agent: string | null;
  content: string;
  thinking: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  is_error: number;
  raw: string | null;
  raw_model: string | null;
  attachments?: string | null;
  cards?: string | null;
  created_at: number;
}

export function messageJson(m: MessageRow) {
  const { raw: _raw, raw_model: _rawModel, ...rest } = m;
  const attachments = parseJson<string[]>(m.attachments, []).map(attachmentInfo);
  return { ...rest, tool_calls: parseJson<ToolCall[] | null>(m.tool_calls, null), is_error: !!m.is_error, attachments, cards: parseJson<Card[]>(m.cards, []) };
}

function insertMessage(m: Omit<MessageRow, 'created_at'> & { created_at?: number }) {
  const row: MessageRow = { ...m, created_at: m.created_at ?? now() };
  run(
    `INSERT INTO messages (id, conversation_id, run_id, role, agent, content, thinking, tool_calls, tool_call_id, tool_name, is_error, raw, raw_model, attachments, cards, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.conversation_id, row.run_id, row.role, row.agent, row.content, row.thinking, row.tool_calls, row.tool_call_id, row.tool_name,
    row.is_error, row.raw, row.raw_model, row.attachments ?? null, row.cards ?? null, row.created_at,
  );
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), row.conversation_id);
  emit({ type: 'message', conversationId: row.conversation_id, message: messageJson(row) });
  return row;
}

function setRunStatus(runId: string, conversationId: string, status: string, error?: string) {
  run('UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?', status, error ?? null, now(), runId);
  emit({ type: 'run.status', runId, conversationId, status, error });
}

function logActivity(e: { conversationId: string; runId: string; agent: string; tool: string; status: string; summary: string; input: unknown; output?: string; ms?: number }) {
  const aid = id('act_');
  run(
    'INSERT INTO activity (id, ts, conversation_id, run_id, agent, tool, status, summary, input, output, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    aid, now(), e.conversationId, e.runId, e.agent, e.tool, e.status, e.summary, truncate(JSON.stringify(e.input), 4000), truncate(e.output ?? '', 4000), e.ms ?? null,
  );
  emit({ type: 'activity', id: aid });
}

/** Rebuild model-ready history: newest messages first-fit, tool calls always paired with results. */
function loadHistory(conversationId: string, limit: number): { messages: ChatMessage[]; trimmed: boolean } {
  let rows = all<MessageRow>("SELECT * FROM messages WHERE conversation_id = ? AND role IN ('user','assistant','tool') ORDER BY rowid", conversationId);
  let trimmed = false;
  if (rows.length > limit) {
    rows = rows.slice(rows.length - limit);
    trimmed = true;
  }
  while (rows.length && rows[0].role !== 'user') rows.shift();

  // Re-sending every image (or file text) on every turn gets expensive, so only the newest few go to the model in full.
  const imageRows = rows.filter((r) => r.role === 'user' && parseJson<string[]>(r.attachments, []).length).slice(-3).map((r) => r.id);

  const out: ChatMessage[] = [];
  let pending: ToolCall[] = [];
  const flush = () => {
    for (const tc of pending) out.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: '(interrupted before a result was recorded)', isError: true });
    pending = [];
  };
  for (const r of rows) {
    if (r.role === 'tool') {
      const idx = pending.findIndex((p) => p.id === r.tool_call_id);
      if (idx < 0) continue; // orphan
      pending.splice(idx, 1);
      out.push({ role: 'tool', toolCallId: r.tool_call_id!, name: r.tool_name ?? '', content: r.content, isError: !!r.is_error });
      continue;
    }
    flush();
    if (r.role === 'user') {
      const ids = parseJson<string[]>(r.attachments, []);
      const recent = imageRows.includes(r.id);
      const infos = ids.map(attachmentInfo);
      const files = ids.map((aid) => attachmentForModel(aid, recent)).filter((x): x is string => !!x);
      const imageIds = infos.filter((a) => a.kind === 'image').map((a) => a.id);
      const text = [r.content, ...files].filter(Boolean).join('\n\n');
      if (imageIds.length && recent) {
        const images = imageIds.map(readImage).filter((x): x is NonNullable<typeof x> => !!x);
        out.push({ role: 'user', content: text, images });
      } else {
        const note = imageIds.length ? `\n[${imageIds.length} earlier image${imageIds.length > 1 ? 's' : ''} not shown]` : '';
        out.push({ role: 'user', content: (text + note).trim() });
      }
    }
    else {
      const toolCalls = parseJson<ToolCall[] | null>(r.tool_calls, null) ?? undefined;
      out.push({ role: 'assistant', content: r.content, toolCalls, raw: parseJson(r.raw, undefined), rawModel: r.raw_model ?? undefined });
      pending = [...(toolCalls ?? [])];
    }
  }
  flush();
  return { messages: out, trimmed };
}

// ───────────────────────── The agent loop ─────────────────────────

interface LoopOptions {
  runId: string;
  conversationId: string;
  agent: { id: string; name: string };
  providerId: string;
  model: string;
  effort?: Effort;
  temperature?: number | null;
  contextLength?: number | null;
  system: string;
  messages: ChatMessage[];
  historyTrimmed?: boolean;
  tools: ToolDef[];
  maxSteps: number;
  signal: AbortSignal;
  /** Main agent: persist + stream into the chat. Sub-agents: report through `progress` instead. */
  persist: boolean;
  parentCallId?: string;
  progress?: ToolContext['progress'];
}

async function agentLoop(o: LoopOptions): Promise<string> {
  const { llm } = resolveProvider(o.providerId);
  const toolSpecs = o.tools.map(toSpec);
  let lastText = '';

  for (let step = 0; step < o.maxSteps; step++) {
    if (o.signal.aborted) throw new Error('aborted');
    const messageId = id('msg_');
    if (o.persist) emit({ type: 'stream.start', conversationId: o.conversationId, runId: o.runId, messageId, agent: o.agent.name });

    let final: AssistantMessage | undefined;
    let notices = '';
    let throttle = 0;
    let buffered = '';
    for await (const part of llm.chat({
      model: o.model,
      system: o.system,
      messages: o.messages,
      tools: toolSpecs,
      signal: o.signal,
      effort: o.effort || undefined,
      temperature: o.temperature,
      contextLength: o.contextLength,
      historyTrimmed: o.historyTrimmed,
    })) {
      if (part.type === 'text') {
        if (o.persist) emit({ type: 'stream.text', conversationId: o.conversationId, messageId, text: part.text });
        else {
          buffered += part.text;
          if (Date.now() - throttle > 250) {
            o.progress?.(buffered, 'text');
            buffered = '';
            throttle = Date.now();
          }
        }
      } else if (part.type === 'thinking') {
        if (o.persist) emit({ type: 'stream.thinking', conversationId: o.conversationId, messageId, text: part.text });
      } else if (part.type === 'notice') {
        notices += `> ${part.text}\n\n`;
        if (o.persist) emit({ type: 'stream.text', conversationId: o.conversationId, messageId, text: `> ${part.text}\n\n` });
      } else if (part.type === 'done') {
        final = part.message;
      }
    }
    if (buffered) o.progress?.(buffered, 'text');
    if (!final) throw new Error('The model stream ended unexpectedly.');
    final.content = notices + final.content;
    lastText = final.content || lastText;
    o.messages.push(final);

    if (o.persist) {
      insertMessage({
        id: messageId,
        conversation_id: o.conversationId,
        run_id: o.runId,
        role: 'assistant',
        agent: o.agent.name,
        content: final.content,
        thinking: final.thinking ?? null,
        tool_calls: final.toolCalls?.length ? JSON.stringify(final.toolCalls) : null,
        tool_call_id: null,
        tool_name: null,
        is_error: 0,
        raw: final.raw ? JSON.stringify(final.raw) : null,
        raw_model: final.rawModel ?? null,
      });
    }

    if (!final.toolCalls?.length) return final.content;

    for (const call of final.toolCalls) {
      const result = await executeTool(call, o);
      const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, name: call.name, content: result.content, isError: result.isError };
      o.messages.push(toolMsg);
      if (o.persist) {
        insertMessage({
          id: id('msg_'),
          conversation_id: o.conversationId,
          run_id: o.runId,
          role: 'tool',
          agent: o.agent.name,
          content: result.content,
          thinking: null,
          tool_calls: null,
          tool_call_id: call.id,
          tool_name: call.name,
          is_error: result.isError ? 1 : 0,
          raw: null,
          raw_model: null,
          cards: result.cards?.length ? JSON.stringify(result.cards) : null,
        });
      }
    }
  }

  const note = `I stopped after ${o.maxSteps} steps so I don't run away with this. Say "continue" and I'll pick up where I left off.`;
  if (o.persist) {
    insertMessage({
      id: id('msg_'), conversation_id: o.conversationId, run_id: o.runId, role: 'assistant', agent: o.agent.name, content: note,
      thinking: null, tool_calls: null, tool_call_id: null, tool_name: null, is_error: 0, raw: null, raw_model: null,
    });
  }
  return lastText ? `${lastText}\n\n(${note})` : note;
}

async function executeTool(call: ToolCall, o: LoopOptions): Promise<{ content: string; isError: boolean; cards?: Card[] }> {
  const tool = o.tools.find((t) => t.name === call.name);
  const base = { conversationId: o.conversationId, runId: o.runId, callId: call.id, parentCallId: o.parentCallId, agent: o.agent.name, name: call.name };
  const finish = (status: string, content: string, isError: boolean, cards?: Card[]) => {
    emit({ type: 'tool.end', ...base, status, preview: truncate(content, 600) });
    return { content, isError, cards };
  };

  if (!tool) {
    emit({ type: 'tool.start', ...base, label: call.name, summary: call.name, args: call.args });
    return finish('error', `Unknown or unavailable tool "${call.name}". Available: ${o.tools.map((t) => t.name).join(', ')}`, true);
  }
  const summary = tool.summarize?.(call.args) ?? `${tool.label}`;
  emit({ type: 'tool.start', ...base, label: tool.label, summary, args: call.args });

  const invalid = validateArgs(tool, call.args);
  if (invalid) return finish('error', `Invalid arguments: ${invalid} Check the tool schema and try again.`, true);

  const decision = decide(tool, call.args);
  if (decision.action === 'deny') {
    logActivity({ ...base, tool: tool.name, status: 'blocked', summary, input: call.args, output: decision.reason });
    return finish('blocked', `Blocked by the user's permission settings (${decision.reason}). Don't try to work around this; tell the user if it matters.`, true);
  }
  const ctxBase = { runId: o.runId, conversationId: o.conversationId, callId: call.id, agent: o.agent.name, signal: o.signal };
  let approved: ToolPreview | undefined;
  let choice: string | undefined;
  if (decision.action === 'ask' && tool.preview) {
    // Fetch the real data the user will approve (e.g. the exact checkout), server-side.
    try {
      approved = await tool.preview(call.args, ctxBase);
    } catch (err) {
      if (o.signal.aborted) throw err;
      return finish('error', `Error: ${errorMessage(err)}`, true);
    }
    if (approved.refuse) {
      logActivity({ ...base, tool: tool.name, status: 'blocked', summary, input: call.args, output: approved.refuse });
      return finish('blocked', approved.refuse, true, approved.cards);
    }
  }
  if (decision.action === 'ask') {
    setRunStatus(o.runId, o.conversationId, 'waiting');
    emit({ type: 'tool.waiting', ...base });
    const decisionResult = await requestApproval({
      runId: o.runId, conversationId: o.conversationId, callId: call.id, agent: o.agent.name, tool, args: call.args,
      summary: approved?.summary ?? summary, scope: decision.scope, preview: approved?.card, signal: o.signal,
    });
    setRunStatus(o.runId, o.conversationId, 'running');
    choice = decisionResult.choice;
    if (!decisionResult.ok) {
      logActivity({ ...base, tool: tool.name, status: 'denied', summary, input: call.args });
      return finish('denied', 'The user denied this action. Do not retry it; continue without it or ask the user what they would prefer.', true);
    }
  }

  const ctx: ToolContext = {
    approved,
    choice,
    runId: o.runId,
    conversationId: o.conversationId,
    callId: call.id,
    agent: o.agent.name,
    signal: o.signal,
    progress: (text, kind = 'text') => emit({ type: 'tool.progress', ...base, text, kind }),
  };
  const t0 = Date.now();
  try {
    const result = await tool.run(call.args, ctx);
    const out = typeof result === 'string' ? result : result.content;
    const cards = typeof result === 'string' ? undefined : result.cards;
    logActivity({ ...base, tool: tool.name, status: decision.action === 'ask' ? 'approved' : 'ok', summary, input: call.args, output: out, ms: Date.now() - t0 });
    return finish('ok', truncate(out, 40_000), false, cards);
  } catch (err) {
    if (o.signal.aborted) throw err;
    const msg = errorMessage(err);
    logActivity({ ...base, tool: tool.name, status: 'error', summary, input: call.args, output: msg, ms: Date.now() - t0 });
    return finish('error', `Error: ${msg}`, true);
  }
}

// ───────────────────────── Sub-agents ─────────────────────────

export function enabledSubagents(): AgentProfile[] {
  return getSettings().subagents.filter((a) => a.enabled);
}

registerTool({
  name: 'delegate',
  label: 'Delegate',
  group: 'Agents',
  description:
    'Hand a self-contained task to a specialist sub-agent and get its result back. The sub-agent cannot see this conversation, so include all needed details in `task`.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Sub-agent id' },
      task: { type: 'string', description: 'Complete, self-contained instructions' },
    },
    required: ['agent', 'task'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => {
    const p = getSettings().subagents.find((s) => s.id === a.agent);
    return `${p?.name ?? a.agent}: ${truncate(String(a.task), 90)}`;
  },
  async run(a, ctx) {
    const profile = enabledSubagents().find((s) => s.id === a.agent);
    if (!profile) return `No enabled sub-agent "${a.agent}". Available: ${enabledSubagents().map((s) => s.id).join(', ') || 'none'}.`;
    const s = getSettings();
    const model = await resolveModel(profile.providerId, profile.model || (profile.providerId === s.main.providerId ? s.main.model : ''));
    const tools = profile.tools.map((n) => getTool(n)).filter((t): t is ToolDef => !!t && t.name !== 'delegate');
    ctx.progress?.(`${profile.name} is on it (${model})`, 'tool');
    return agentLoop({
      runId: ctx.runId,
      conversationId: ctx.conversationId,
      agent: { id: profile.id, name: profile.name },
      providerId: profile.providerId,
      model,
      effort: profile.effort,
      temperature: profile.temperature,
      contextLength: profile.contextLength,
      system: subagentSystemPrompt(profile),
      messages: [{ role: 'user', content: String(a.task) }],
      tools,
      maxSteps: profile.maxSteps ?? 12,
      signal: ctx.signal,
      persist: false,
      parentCallId: ctx.callId,
      progress: ctx.progress,
    });
  },
});

function mainTools(): ToolDef[] {
  const subs = enabledSubagents();
  return listTools()
    .filter((t) => (t.name === 'delegate' ? subs.length > 0 : true))
    .map((t) =>
      t.name === 'delegate'
        ? {
            ...t,
            description: `${t.description}\nAvailable sub-agents:\n${subs.map((s) => `- ${s.id} (${s.name}): ${s.description}`).join('\n')}`,
            parameters: { ...t.parameters, properties: { ...t.parameters.properties, agent: { type: 'string', enum: subs.map((s) => s.id) } } },
          }
        : t,
    )
    .filter((t) => (getSettings().policies[t.name] ?? t.defaultPolicy) !== 'deny');
}

// ───────────────────────── Starting runs ─────────────────────────

export function createConversation(title = 'New chat', kind = 'chat') {
  const cid = id('c_');
  run('INSERT INTO conversations (id, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', cid, title, kind, now(), now());
  emit({ type: 'conversation.changed', id: cid });
  return cid;
}

export function startRun(conversationId: string, text: string, source: 'user' | 'schedule' = 'user', attachments: string[] = []): string {
  const conv = get<{ id: string; title: string }>('SELECT id, title FROM conversations WHERE id = ?', conversationId);
  if (!conv) throw new HttpError(404, 'Conversation not found');
  if (activeRunFor(conversationId)) throw new HttpError(409, "I'm still working on the last request in this chat. Stop it or wait for it to finish.");

  const runId = id('r_');
  run('INSERT INTO runs (id, conversation_id, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', runId, conversationId, 'running', source, now(), now());
  insertMessage({
    id: id('msg_'), conversation_id: conversationId, run_id: runId, role: 'user', agent: source === 'schedule' ? 'Schedule' : null, content: text,
    thinking: null, tool_calls: null, tool_call_id: null, tool_name: null, is_error: 0, raw: null, raw_model: null,
    attachments: attachments.length ? JSON.stringify(attachments) : null,
  });
  if (conv.title === 'New chat') {
    const title = text.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 60) || (attachments.length ? attachmentInfo(attachments[0]).name : 'New chat');
    run('UPDATE conversations SET title = ? WHERE id = ?', title, conversationId);
    emit({ type: 'conversation.changed', id: conversationId });
  }

  const controller = new AbortController();
  active.set(runId, { runId, conversationId, controller });
  emit({ type: 'run.status', runId, conversationId, status: 'running' });
  void execute(runId, conversationId, controller, source);
  return runId;
}

async function execute(runId: string, conversationId: string, controller: AbortController, source: 'user' | 'schedule') {
  const s = getSettings();
  try {
    const model = await resolveModel(s.main.providerId, s.main.model);
    run('UPDATE runs SET model = ? WHERE id = ?', model, runId);
    const history = loadHistory(conversationId, s.main.contextMessages);
    const answer = await agentLoop({
      runId,
      conversationId,
      agent: { id: 'main', name: s.persona.name },
      providerId: s.main.providerId,
      model,
      effort: s.main.effort,
      temperature: s.main.temperature,
      contextLength: s.main.contextLength,
      system: mainSystemPrompt(),
      messages: history.messages,
      historyTrimmed: history.trimmed,
      tools: mainTools(),
      maxSteps: s.main.maxSteps,
      signal: controller.signal,
      persist: true,
    });
    setRunStatus(runId, conversationId, 'done');
    if (source !== 'user' || connectedClients() === 0) {
      const title = get<{ title: string }>('SELECT title FROM conversations WHERE id = ?', conversationId)?.title ?? 'Task';
      void notify({ title: `${s.persona.name} · ${title}`, body: truncate(answer.replace(/[#*_>`]/g, ''), 180), link: `/chat/${conversationId}`, kind: source === 'schedule' ? 'schedule' : 'run' });
    }
  } catch (err) {
    if (controller.signal.aborted) {
      setRunStatus(runId, conversationId, 'cancelled');
    } else {
      const msg = errorMessage(err);
      insertMessage({
        id: id('msg_'), conversation_id: conversationId, run_id: runId, role: 'error', agent: s.persona.name, content: msg,
        thinking: null, tool_calls: null, tool_call_id: null, tool_name: null, is_error: 1, raw: null, raw_model: null,
      });
      setRunStatus(runId, conversationId, 'error', msg);
      if (source !== 'user') void notify({ title: `${s.persona.name} hit a problem`, body: truncate(msg, 160), link: `/chat/${conversationId}`, kind: 'run' });
    }
  } finally {
    active.delete(runId);
  }
}

/** Mark runs left over from a previous process as interrupted. */
export function recoverRuns() {
  run("UPDATE runs SET status = 'interrupted', updated_at = ? WHERE status IN ('running','waiting')", now());
}

/** A single tool-less completion with the main model (used by Spaces' sable.ask). */
export async function quickAnswer(system: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const s = getSettings();
  const model = await resolveModel(s.main.providerId, s.main.model);
  const { llm } = resolveProvider(s.main.providerId);
  let text = '';
  for await (const part of llm.chat({ model, system, messages: [{ role: 'user', content: prompt }], tools: [], signal })) {
    if (part.type === 'done') text = part.message.content;
  }
  return text;
}
