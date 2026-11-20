import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { allConnectionSecrets } from './connections.js';
import { all, get, kvGet, kvSet, run } from './db.js';
import { emit } from './events.js';
import { getSettings } from './settings.js';

/**
 * Safety ideas borrowed from Oni (docs/research/oni-notes.md):
 *  - redaction: known secret values and secret-looking strings never leave Sable (channels, webhooks,
 *    email, notifications) and never reach the model through tool results;
 *  - freeze: one switch makes Sable observe-only;
 *  - taint: once a run has read untrusted content, actions that reach outside Sable ask first;
 *  - a tamper-evident (HMAC-chained) activity log.
 */

// ───────────── Redaction ─────────────

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI / Anthropic keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // Telegram bot tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
];
const ASSIGNMENT = /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)(\s*[=:]\s*["']?)([^\s"']{6,})/gi;

let known: { at: number; values: string[] } = { at: 0, values: [] };

/** Secret values Sable holds: provider keys, mailbox passwords, channel tokens, connection keys… */
function knownSecrets(): string[] {
  if (Date.now() - known.at < 60_000) return known.values;
  const s = getSettings();
  const vals: string[] = [];
  for (const p of s.providers) if (p.apiKey) vals.push(p.apiKey);
  for (const c of s.channels) {
    if (c.token) vals.push(c.token);
    // Discord/Slack/ntfy URLs carry their secret in the path.
    if (/discord|slack|ntfy/i.test(c.url) && c.url.length > 30) vals.push(c.url);
  }
  for (const a of s.email?.accounts ?? []) if (a.password) vals.push(a.password, a.password.replace(/\s+/g, ''));
  for (const m of s.mcpServers) {
    for (const v of Object.values(m.env ?? {})) if (v) vals.push(v);
    for (const v of Object.values(m.headers ?? {})) if (v) vals.push(v.replace(/^Bearer\s+/i, ''));
    if (m.oauth?.clientSecret) vals.push(m.oauth.clientSecret);
  }
  if (s.google?.clientSecret) vals.push(s.google.clientSecret);
  if ((s.shopping as { clientSecret?: string } | undefined)?.clientSecret) vals.push((s.shopping as { clientSecret: string }).clientSecret);
  try {
    vals.push(...allConnectionSecrets());
  } catch {
    /* vault unavailable */
  }
  const values = [...new Set(vals.map((v) => v.trim()).filter((v) => v.length >= 8))].sort((a, b) => b.length - a.length);
  known = { at: Date.now(), values };
  return values;
}

export function forgetSecretCache() {
  known = { at: 0, values: [] };
}

/** Replace secrets with [REDACTED]. Cheap enough to run on every outgoing message and tool result. */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const v of knownSecrets()) if (out.includes(v)) out = out.split(v).join('[REDACTED]');
  for (const p of PATTERNS) out = out.replace(p, '[REDACTED]');
  out = out.replace(ASSIGNMENT, (_m, k: string, sep: string) => `${k}${sep}[REDACTED]`);
  return out;
}

// ───────────── Freeze ─────────────

export function isFrozen() {
  return kvGet<boolean>('frozen') === true;
}

export function setFrozen(on: boolean, by = 'you') {
  kvSet('frozen', on);
  emit({ type: 'safety.changed', frozen: on, by });
}

/** Tools that only look: allowed while frozen. Everything else is blocked. */
const READ_ONLY = /^(web_search|web_fetch|tools_search|calendar_events|calendar_free_time|file_list|file_read|connect_read|memory_search|show_.*|.*_(search|list|read|get|view|orders|lookup|product))$/;
export function isReadOnlyTool(name: string) {
  return READ_ONLY.test(name);
}

// ───────────── Taint ─────────────

const tainted = new Map<string, string>();

/** Mark a run (or background job) as having read untrusted content; remembers where it came from. */
export function markTainted(runId: string, source: string) {
  if (!tainted.has(runId)) {
    tainted.set(runId, source);
    emit({ type: 'run.tainted', runId, source });
  }
}
export function taintOf(runId: string) {
  return tainted.get(runId);
}
export function clearTaint(runId: string) {
  tainted.delete(runId);
}

/** Where untrusted text in a message came from, if any (`<untrusted source="…">`). */
export function untrustedSource(text: string): string | undefined {
  const m = /<untrusted source="([^"]*)"/.exec(text);
  return m ? m[1] || 'untrusted content' : undefined;
}

/** Tools that change things outside Sable, or run code: with untrusted content in play, they ask first. */
const INTERNAL_WRITES = new Set(['file_write', 'file_edit', 'schedule_update', 'reminder_set', 'reminder_update', 'reminder_cancel']);
export function taintEscalates(tool: { name: string; risk?: string }) {
  if (isReadOnlyTool(tool.name)) return false;
  if (INTERNAL_WRITES.has(tool.name)) return false;
  return tool.risk === 'medium' || tool.risk === 'high';
}

// ───────────── Tamper-evident activity log ─────────────

function auditKey(): Buffer {
  const file = path.join(DATA_DIR, 'audit.key');
  if (process.env.SABLE_AUDIT_KEY) return Buffer.from(process.env.SABLE_AUDIT_KEY);
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim());
}
let keyCache: Buffer | null = null;
const GENESIS = '0'.repeat(64);

interface ActivityFields {
  id: string;
  ts: number;
  conversation_id: string | null;
  run_id: string | null;
  agent: string | null;
  tool: string;
  status: string;
  summary: string | null;
  input: string | null;
  output: string | null;
  duration_ms: number | null;
}

function chainHash(prev: string, r: ActivityFields) {
  keyCache ??= auditKey();
  const body = JSON.stringify([r.id, r.ts, r.conversation_id, r.run_id, r.agent, r.tool, r.status, r.summary, r.input, r.output, r.duration_ms]);
  return crypto.createHmac('sha256', keyCache).update(prev + body).digest('hex');
}

/** Insert an activity row chained to the previous one: editing or deleting any row breaks the chain. */
export function appendActivity(r: ActivityFields) {
  const prev = get<{ hash: string | null }>('SELECT hash FROM activity WHERE hash IS NOT NULL ORDER BY rowid DESC LIMIT 1')?.hash ?? GENESIS;
  const hash = chainHash(prev, r);
  run(
    'INSERT INTO activity (id, ts, conversation_id, run_id, agent, tool, status, summary, input, output, duration_ms, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    r.id, r.ts, r.conversation_id, r.run_id, r.agent, r.tool, r.status, r.summary, r.input, r.output, r.duration_ms, prev, hash,
  );
}

/** Walk the chain. Rows written before the chain existed (no hash) are skipped. */
export function verifyActivity(): { ok: boolean; checked: number; brokenAt?: string; message: string } {
  let prev = GENESIS;
  let checked = 0;
  for (const r of all<ActivityFields & { prev_hash: string | null; hash: string | null }>('SELECT * FROM activity WHERE hash IS NOT NULL ORDER BY rowid')) {
    if (r.prev_hash !== prev || chainHash(prev, r) !== r.hash) {
      return { ok: false, checked, brokenAt: r.id, message: `The log was changed at entry ${checked + 1} (${new Date(r.ts).toLocaleString()}).` };
    }
    prev = r.hash!;
    checked++;
  }
  return { ok: true, checked, message: checked ? `All ${checked} entries are intact.` : 'No entries yet.' };
}
