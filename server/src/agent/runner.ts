import { all, get, run } from '../db.js';
import { connectedClients, emit } from '../events.js';
import { resolveModel, resolveProvider } from '../llm/index.js';
import type { AssistantMessage, ChatMessage, ToolCall } from '../llm/types.js';
import { notify } from '../push.js';
import { getSettings, type AgentProfile, type Effort } from '../settings.js';
import { errorMessage, id, now, parseJson, truncate } from '../util.js';
import { mainSystemPrompt } from './prompt.js';
import { appendActivity, clearTaint, isFrozen, setFrozen, verifyActivity, isReadOnlyTool, markTainted, redact, taintEscalates, taintOf, untrustedSource } from '../safety.js';
import { isRestricted, preapprovalFor, shouldNotifyAfterRun, type Preapproval } from './automation.js';
import { searchTools, selectTools } from './routing.js';
import { relevantMemories, toolsMentioned } from './tools/personal.js';
import { attachmentForModel, attachmentInfo, claimUploads, readImage } from '../uploads.js';
import { decide, denyAllApprovals, requestApproval } from './sentinel.js';
import { getTool, listTools, registerTool, toSpec, validateArgs, type Card, type ToolContext, type ToolDef, type ToolPreview } from './tools/registry.js';

// ───────────────────────── Active runs ─────────────────────────

interface ActiveRun {
  runId: string;
  conversationId: string;
  controller: AbortController;
  /** Messages the user slipped in while this run works; picked up at the next step. */
  inbox: string[];
  /** Set for runs of an approved routine: its steps don't ask again (with exceptions). */
  preapproved: Preapproval | null;
}
const active = new Map<string, ActiveRun>();

export function activeRunFor(conversationId: string): ActiveRun | undefined {
  for (const r of active.values()) if (r.conversationId === conversationId) return r;
}
export function activeRuns() {
  return [...active.values()].map((r) => ({ runId: r.runId, conversationId: r.conversationId }));
}
/** Add a message to the chat's running task at its next step; starts a new run if nothing is running. */
export function interject(conversationId: string, text: string): { runId: string; interjected: boolean } {
  const run = activeRunFor(conversationId);
  if (run && !run.controller.signal.aborted) {
    run.inbox.push(text);
    emit({ type: 'run.interject', conversationId, runId: run.runId, text });
    return { runId: run.runId, interjected: true };
  }
  return { runId: startRun(conversationId, text), interjected: false };
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
  appendActivity({
    id: aid, ts: now(), conversation_id: e.conversationId, run_id: e.runId, agent: e.agent, tool: e.tool, status: e.status, summary: e.summary,
    input: truncate(redact(JSON.stringify(e.input)), 4000), output: truncate(redact(e.output ?? ''), 4000), duration_ms: e.ms ?? null,
  });
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
      const files = ids.map((aid) => attachmentForModel(aid, recent, r.conversation_id)).filter((x): x is string => !!x);
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

export interface LoopOptions {
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
  /** Steps the user already approved (an approved routine, or a background job it started). */
  preapproved?: Preapproval | null;
  /** Sub-agents: always end with a real report of what was found, and say how the run ended. */
  outcome?: LoopOutcome;
}

export interface LoopOutcome {
  /** 'limit': ran out of steps; 'plan': ended on a plan instead of results. */
  stopped?: 'limit' | 'plan';
  /** A final report was requested with tools set aside. */
  forcedReport?: boolean;
  /** Tool results were attached because the report came back thin. */
  digest?: boolean;
  toolCalls?: number;
}

/** "I'll search for…", "Let me check…": a reply that only announces work instead of reporting it. */
function looksLikePlan(text: string) {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 700) return false;
  return /\b(let me|i'll|i will|i'm going to|i am going to|next,? i|now i'll|first,? i'll|i need to)\b/i.test(t) && !/\b(found|results?|summary|in short|here'?s what)\b/i.test(t);
}

/** Compact list of what the tools returned, so findings survive even a weak final report. */
function toolDigest(messages: ChatMessage[], budget = 6000) {
  const lines: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const m of messages) {
    if (m.role !== 'tool' || m.isError) continue;
    const body = String(m.content ?? '').replace(/\s+/g, ' ').trim();
    // Skip empties and repeats ("No results" thirty times tells nobody anything).
    if (body.length < 25 || seen.has(body)) continue;
    seen.add(body);
    const line = `- ${m.name}: ${body.slice(0, 450)}${body.length > 450 ? '…' : ''}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

/** One more model call with tools set aside: write up everything found so far. */
async function finalReport(o: LoopOptions, why: 'limit' | 'plan'): Promise<string> {
  const { llm } = resolveProvider(o.providerId);
  const ask =
    why === 'limit'
      ? 'You have used all your steps. Do not call any more tools. Write your final report now for the agent that asked you: everything you found (facts, numbers, names, quotes) with the source URL or file for each, what you did, and what is still missing or uncertain. Report results, not plans.'
      : 'Do not describe what you are going to do. Do not call any more tools. Write your final report now: everything your tool results showed (facts, numbers, names) with the source URL or file for each, and what is still missing. If you found nothing useful, say so plainly.';
  o.messages.push({ role: 'user', content: ask });
  let text = '';
  try {
    for await (const part of llm.chat({
      model: o.model,
      system: o.system,
      messages: o.messages,
      // Some providers reject a history with tool calls but no tool definitions, so keep them listed; the instruction says not to use them.
      tools: o.tools.map(toSpec),
      signal: o.signal,
      effort: o.effort || undefined,
      temperature: o.temperature,
      contextLength: o.contextLength,
    })) {
      if (part.type === 'text') {
        text += part.text;
        o.progress?.(part.text, 'text');
      } else if (part.type === 'done') {
        text = part.message.content || text;
      }
    }
  } catch (err) {
    if (o.signal.aborted) throw err;
  }
  return text.trim();
}

/** Sub-agent ending: make sure the findings come back, never just a plan. */
async function wrapUp(o: LoopOptions, lastText: string, why: 'limit' | 'plan'): Promise<string> {
  const out = o.outcome!;
  out.stopped = why;
  out.forcedReport = true;
  out.toolCalls = o.messages.filter((m) => m.role === 'tool').length;
  const report = await finalReport(o, why);
  let text = report && !looksLikePlan(report) ? report : '';
  if (!text) text = report || lastText;
  const thin = text.length < 400 || looksLikePlan(text);
  if (thin && out.toolCalls) {
    const digest = toolDigest(o.messages);
    if (digest) {
      out.digest = true;
      text = `${text ? `${text}\n\n` : ''}What my tools returned (raw, for you to use):\n${digest}`;
    }
  }
  const note = why === 'limit' ? `(Stopped at the ${o.maxSteps}-step limit. The job can be continued.)` : '';
  return [text || '(No findings.)', note].filter(Boolean).join('\n\n');
}

export async function agentLoop(o: LoopOptions): Promise<string> {
  const { llm } = resolveProvider(o.providerId);
  let toolSpecs = o.tools.map(toSpec);
  let lastText = '';

  for (let step = 0; step < o.maxSteps; step++) {
    if (o.signal.aborted) throw new Error('aborted');
    // Tools the model loaded with tools_search join from the next step.
    for (const t of loadedTools.get(o.runId) ?? []) if (!o.tools.some((x) => x.name === t.name)) o.tools.push(t);
    if (toolSpecs.length !== o.tools.length) toolSpecs = o.tools.map(toSpec);
    // Interjections: the user's new messages join the conversation between steps, without stopping the run.
    const inbox = o.persist ? active.get(o.runId)?.inbox : undefined;
    while (inbox?.length) {
      const text = inbox.shift()!;
      insertMessage({
        id: id('msg_'), conversation_id: o.conversationId, run_id: o.runId, role: 'user', agent: null, content: text,
        thinking: null, tool_calls: null, tool_call_id: null, tool_name: null, is_error: 0, raw: null, raw_model: null,
      });
      o.messages.push({ role: 'user', content: `${text}\n\n(Sent while you were working. Take it into account and carry on.)` });
    }
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

    if (!final.toolCalls?.length) {
      // Something was slipped in while this answer was being written: answer it in the same run.
      if (o.persist && active.get(o.runId)?.inbox.length) continue;
      // A sub-agent that used tools but ended by announcing more work: get the real report.
      if (o.outcome && o.messages.some((m) => m.role === 'tool') && looksLikePlan(final.content)) return wrapUp(o, final.content, 'plan');
      return final.content;
    }

    // Sub-agent hand-offs in the same step run side by side; everything else runs in order.
    const parallel = final.toolCalls.map((call) => (call.name === 'delegate' ? executeTool(call, o) : null));
    for (const [i, call] of final.toolCalls.entries()) {
      const result = await (parallel[i] ?? executeTool(call, o));
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

  if (o.outcome) return wrapUp(o, lastText, 'limit');
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
  let tool = o.tools.find((t) => t.name === call.name);
  // The main agent asked for a real tool that just wasn't loaded for this message: load it instead of failing.
  if (!tool && o.persist) {
    const found = mainTools().find((t) => t.name === call.name);
    if (found) {
      o.tools.push(found);
      tool = found;
    }
  }
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
  // Frozen: observe only. Nothing that changes anything runs, approved or not.
  if (isFrozen() && !isReadOnlyTool(tool.name)) {
    decision.action = 'deny';
    decision.reason = 'Sable is frozen (observe only). Unfreeze it to act again';
  }
  // Untrusted content (a web page, an email, an API reply) is in this task: actions that reach
  // outside Sable need the user's OK, so injected instructions can't make them happen on their own.
  const taint = taintOf(o.runId);
  if (decision.action === 'allow' && taint && taintEscalates(tool)) {
    decision.action = 'ask';
    decision.reason = `This task has read untrusted content (${taint}), so actions that reach outside Sable need your OK`;
  }
  if (decision.action === 'deny') {
    logActivity({ ...base, tool: tool.name, status: 'blocked', summary, input: call.args, output: decision.reason });
    return finish('blocked', `Blocked by the user's permission settings (${decision.reason}). Don't try to work around this; tell the user if it matters.`, true);
  }
  // An approved routine's run: the user already said yes to its steps when they approved it.
  const pre = o.preapproved ?? active.get(o.runId)?.preapproved;
  if (decision.action === 'ask' && pre && !tool.alwaysAsk && !isRestricted(pre, tool.name)) {
    decision.action = 'allow';
    decision.reason = 'Pre-approved with the routine';
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
    const ownRun = active.has(o.runId);
    if (ownRun) setRunStatus(o.runId, o.conversationId, 'waiting');
    emit({ type: 'tool.waiting', ...base });
    const decisionResult = await requestApproval({
      runId: o.runId, conversationId: o.conversationId, callId: call.id, agent: o.agent.name, tool, args: call.args,
      summary: approved?.summary ?? summary, scope: decision.scope, preview: approved?.card, signal: o.signal,
    });
    if (ownRun) setRunStatus(o.runId, o.conversationId, 'running');
    choice = decisionResult.choice;
    // Frozen while the approval was waiting: the answer no longer matters.
    if (decisionResult.ok && isFrozen() && !isReadOnlyTool(tool.name)) decisionResult.ok = false;
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
    // Secrets never reach the model (or a cloud provider) through a tool result.
    const out = redact(typeof result === 'string' ? result : result.content);
    const src = untrustedSource(out);
    if (src) markTainted(o.runId, src);
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
// The delegate tool and background jobs live in subagents.ts.

export function enabledSubagents(): AgentProfile[] {
  return getSettings().subagents.filter((a) => a.enabled);
}

/** Hook for subagents.ts: describe the delegate tool with the current agents. */
let delegateDecorator: ((t: ToolDef) => ToolDef) | null = null;
export function setDelegateDecorator(f: (t: ToolDef) => ToolDef) {
  delegateDecorator = f;
}

export function mainTools(): ToolDef[] {
  return listTools()
    .map((t) => (t.name === 'delegate' && delegateDecorator ? delegateDecorator(t) : t))
    .filter((t) => (getSettings().policies[t.name] ?? t.defaultPolicy) !== 'deny');
}

/** Tools a run loaded on demand with tools_search. */
const loadedTools = new Map<string, ToolDef[]>();

registerTool({
  name: 'tools_search',
  label: 'Find tools',
  group: 'Core',
  description:
    "Find and load tools you don't currently have (only a relevant subset is loaded for each message). Describe what you need, e.g. \"send an email\", \"watch a price\", \"read a calendar\". The matching tools become available on your next step.",
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Find tools for “${a.query}”`,
  async run(a, ctx) {
    const found = await searchTools(mainTools(), String(a.query));
    if (!found.length) return 'No matching tools. You may not have a tool for that; tell the user what you can do instead.';
    // Load whole groups, so related tools (list / create / update) come together.
    const groupsHit = new Set(found.slice(0, 4).map((t) => t.group));
    const load = mainTools().filter((t) => groupsHit.has(t.group) || found.includes(t));
    loadedTools.set(ctx.runId, [...(loadedTools.get(ctx.runId) ?? []), ...load]);
    return `Loaded ${load.length} tools, available from your next step:\n${load.map((t) => `- ${t.name}: ${t.description.split(/(?<=\.)\s/)[0]}`).join('\n')}`;
  },
});

/** Tool groups used in the last few turns stay loaded, so follow-ups ("make it 9pm") still work. */
function recentGroups(conversationId: string): Set<string> {
  const rows = all<{ tool_calls: string | null }>("SELECT tool_calls FROM messages WHERE conversation_id = ? AND role = 'assistant' AND tool_calls IS NOT NULL ORDER BY created_at DESC LIMIT 6", conversationId);
  const out = new Set<string>();
  for (const r of rows) for (const c of parseJson<ToolCall[]>(r.tool_calls, [])) {
    const t = getTool(c.name);
    if (t) out.add(t.group);
  }
  return out;
}

// ───────────────────────── Starting runs ─────────────────────────

export function createConversation(title = 'New chat', kind = 'chat') {
  const cid = id('c_');
  run('INSERT INTO conversations (id, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', cid, title, kind, now(), now());
  emit({ type: 'conversation.changed', id: cid });
  return cid;
}

/**
 * Reflexes: a few commands handled instantly, without the model (so they work even when it's down).
 * Returns true when the text was a reflex; the exchange is still written into the chat.
 */
export function reflex(conversationId: string, text: string): boolean {
  const m = /^\/(freeze|stop-all|thaw|unfreeze|status|help)\b/i.exec(text.trim());
  if (!m) return false;
  const cmd = m[1].toLowerCase();
  let reply: string;
  if (cmd === 'freeze' || cmd === 'stop-all') {
    setFrozen(true, 'reflex');
    const n = denyAllApprovals();
    reply = `Frozen. I'll only look, not act, until you send /thaw.${n ? ` Denied ${n} pending request${n > 1 ? 's' : ''}.` : ''}`;
  } else if (cmd === 'thaw' || cmd === 'unfreeze') {
    setFrozen(false, 'reflex');
    reply = 'Unfrozen. Acting normally again.';
  } else if (cmd === 'status') {
    const runs = activeRuns().length;
    const pending = all<{ n: number }>("SELECT count(*) n FROM approvals WHERE status = 'pending'")[0]?.n ?? 0;
    const jobs = all<{ n: number }>("SELECT count(*) n FROM agent_jobs WHERE status = 'running'")[0]?.n ?? 0;
    const chain = verifyActivity();
    reply = [
      `${isFrozen() ? 'Frozen (observe only)' : 'Running normally'}.`,
      `${runs} task${runs === 1 ? '' : 's'} working, ${jobs} sub-agent${jobs === 1 ? '' : 's'} running, ${pending} approval${pending === 1 ? '' : 's'} waiting.`,
      `Activity log: ${chain.ok ? chain.message : `⚠ ${chain.message}`}`,
    ].join('\n');
  } else {
    reply = 'Instant commands (no AI involved):\n/freeze: stop acting, only look; denies pending approvals\n/thaw: act again\n/status: what is running and whether the activity log is intact';
  }
  const base = { conversation_id: conversationId, run_id: null, thinking: null, tool_calls: null, tool_call_id: null, tool_name: null, is_error: 0, raw: null, raw_model: null } as const;
  insertMessage({ ...base, id: id('msg_'), role: 'user', agent: null, content: text.trim() });
  insertMessage({ ...base, id: id('msg_'), role: 'assistant', agent: getSettings().persona.name, content: reply });
  return true;
}

export function startRun(conversationId: string, text: string, source: 'user' | 'schedule' = 'user', attachments: string[] = []): string {
  const conv = get<{ id: string; title: string }>('SELECT id, title FROM conversations WHERE id = ?', conversationId);
  if (!conv) throw new HttpError(404, 'Conversation not found');
  if (activeRunFor(conversationId)) throw new HttpError(409, "I'm still working on the last request in this chat. Stop it or wait for it to finish.");

  const runId = id('r_');
  if (attachments.length) claimUploads(conversationId, attachments);
  run('INSERT INTO runs (id, conversation_id, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', runId, conversationId, 'running', source, now(), now());
  insertMessage({
    id: id('msg_'), conversation_id: conversationId, run_id: runId, role: 'user', agent: source === 'schedule' ? 'Schedule' : null, content: text,
    thinking: null, tool_calls: null, tool_call_id: null, tool_name: null, is_error: 0, raw: null, raw_model: null,
    attachments: attachments.length ? JSON.stringify(attachments) : null,
  });
  if (conv.title === 'New chat') {
    // A quick placeholder right away, then a real name ("Essay help") generated in the background.
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const title = (words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '')).slice(0, 48) || (attachments.length ? attachmentInfo(attachments[0]).name : 'New chat');
    run('UPDATE conversations SET title = ? WHERE id = ?', title, conversationId);
    emit({ type: 'conversation.changed', id: conversationId });
    if (text.trim()) void nameChat(conversationId, title, text);
  }

  const controller = new AbortController();
  active.set(runId, { runId, conversationId, controller, inbox: [], preapproved: source === 'schedule' ? preapprovalFor(conversationId) : null });
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
    const lastUser = [...history.messages].reverse().find((m) => m.role === 'user');
    const query = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 2000) : '';
    // Woken by an email, a webhook or a watcher: their content is untrusted from the first step.
    const wakeSource = typeof lastUser?.content === 'string' ? untrustedSource(lastUser.content) : undefined;
    if (wakeSource) markTainted(runId, wakeSource);
    const memories = await relevantMemories(query);
    // How-to memories that name tools make sure those tools are loaded.
    const allTools = mainTools();
    const wanted = new Set(toolsMentioned(memories, allTools.map((t) => t.name)).map((n) => allTools.find((t) => t.name === n)!.group));
    const picked = await selectTools(allTools, query, new Set([...recentGroups(conversationId), ...wanted]));
    // A correction or standing instruction is a chance to learn a how-to.
    const correction = /\b(no,? use|use (?:a |the )?\w+ instead|instead of|next time|from now on|always (?:use|do|send|check)|never (?:use|do|send)|don'?t use|stop using|i (?:want|prefer) you to (?:use|do)|that should(?: have)? been)\b/i.test(query);
    const answer = await agentLoop({
      runId,
      conversationId,
      agent: { id: 'main', name: s.persona.name },
      providerId: s.main.providerId,
      model,
      effort: s.main.effort,
      temperature: s.main.temperature,
      contextLength: s.main.contextLength,
      system: mainSystemPrompt({ memories, learnNote: correction ? 'The user\'s last message sounds like a correction or a standing instruction about how to handle this kind of request. Follow it, and if it should apply next time too, save it with memory_save kind "howto".' : '', toolNote: picked.method === 'all' ? '' : 'Only the tools relevant to this request are loaded. If you need a tool you don\'t see (email, calendar, watchers, routines, webhooks, shopping, files, spaces…), call tools_search first.' }),
      messages: history.messages,
      historyTrimmed: history.trimmed,
      tools: picked.tools,
      maxSteps: s.main.maxSteps,
      signal: controller.signal,
      persist: true,
    });
    setRunStatus(runId, conversationId, 'done');
    // Background runs notify only when there's something to say (see automation.ts).
    if (source !== 'user' ? shouldNotifyAfterRun(conversationId, runId, answer) : connectedClients() === 0) {
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
    loadedTools.delete(runId);
    clearTaint(runId);
  }
}

/** Mark runs left over from a previous process as interrupted. */
export function recoverRuns() {
  run("UPDATE runs SET status = 'interrupted', updated_at = ? WHERE status IN ('running','waiting')", now());
}

/** A single tool-less completion with the main model (used by Spaces' sable.ask). */
/** Give a chat a short, human name from its first message. Never overwrites a rename by the user. */
async function nameChat(conversationId: string, placeholder: string, text: string) {
  try {
    const raw = await quickAnswer(
      'You name chat conversations. Reply with only a short title of 2 to 5 words that says what the user wants help with, in sentence case, like "Essay help: Brian Christian", "Ryzen 5 5500 vs 5600" or "Weekly meal plan". No quotes, no emoji, no trailing period.',
      `First message:\n${text.slice(0, 1500)}`,
      AbortSignal.timeout(45_000),
    );
    const title = raw.replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop()?.replace(/^["'*#\s]+|["'*.\s]+$/g, '').replace(/^title:\s*/i, '').slice(0, 60);
    if (!title || title.split(' ').length > 9) return;
    const cur = get<{ title: string }>('SELECT title FROM conversations WHERE id = ?', conversationId);
    if (cur?.title !== placeholder) return; // renamed meanwhile
    run('UPDATE conversations SET title = ? WHERE id = ?', title, conversationId);
    emit({ type: 'conversation.changed', id: conversationId });
  } catch {
    /* keep the placeholder */
  }
}

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
