import { nudgeInitiative } from './initiative.js';
import { all, get, run } from './db.js';
import { emit } from './events.js';
import { activeRunFor, createConversation, startRun } from './agent/runner.js';
import { fmt } from './clock.js';
import { errorMessage, id, now, parseJson, truncate } from './util.js';

/**
 * Duties: what Sable is responsible for (docs/design/autonomy.md §2).
 *
 * A duty is a responsibility in plain words ("track my refund until it lands"), instructions, how
 * free Sable is with it (act, suggest, watch), and its own memory. Routines, watchers, webhooks
 * and mail don't run agents of their own any more: they raise *signals*, and a signal wakes the
 * duties it belongs to. Each run sees the duty's purpose, what it remembered last time and the
 * user's feedback, and ends with finish (verdict + what to remember).
 *
 * Existing routines, watchers with instructions and webhooks with instructions are adopted as
 * duties automatically (adoptAll), so nothing has to be set up again.
 */

export type Autonomy = 'act' | 'suggest' | 'watch';
export interface MailTrigger {
  from?: string;
  subject?: string;
}
export interface DutyRow {
  id: string;
  title: string;
  purpose: string;
  instructions: string;
  autonomy: Autonomy;
  restrict_tools: string | null;
  notify: 'always' | 'when_new';
  memory: string | null;
  conversation_id: string | null;
  status: 'active' | 'paused' | 'done';
  origin: string;
  mail: string | null; // MailTrigger JSON
  created_at: number;
  last_run: number | null;
  runs: number;
}

export interface Signal {
  /** Where it came from: "schedule:sch_…", "watch:w_…", "hook:h_…", "mail:someone@x.com", "reminder:…". */
  source: string;
  kind: 'time' | 'watch' | 'hook' | 'mail' | 'reminder' | 'calendar' | 'manual';
  title: string;
  /** Details. Outside content must already be wrapped in <untrusted> by the caller. */
  body?: string;
}

/** The tools that always ask, even in a duty that acts on its own. */
export const ALWAYS_ASK = ['send', 'buy', 'delete', 'checkout', 'purchase'];

// ── Signals ──

export function recordSignal(sig: Signal, dutyId?: string | null) {
  run(
    'INSERT INTO signals (id, source, kind, title, body, duty_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id('sig_'), sig.source, sig.kind, truncate(sig.title, 300), sig.body ? truncate(sig.body, 4000) : null, dutyId ?? null, now(),
  );
  // Something notable came in: Sable checks in soon, on its own.
  if (sig.kind === 'mail' || sig.kind === 'calendar' || sig.kind === 'hook') nudgeInitiative();
  // Keep the last couple of thousand; older ones aren't useful.
  run('DELETE FROM signals WHERE id IN (SELECT id FROM signals ORDER BY created_at DESC LIMIT -1 OFFSET 2000)');
}

export function recentSignals(limit = 50, dutyId?: string) {
  return dutyId
    ? all<{ id: string; source: string; kind: string; title: string; created_at: number; duty_id: string | null }>('SELECT id, source, kind, title, created_at, duty_id FROM signals WHERE duty_id = ? ORDER BY created_at DESC LIMIT ?', dutyId, limit)
    : all<{ id: string; source: string; kind: string; title: string; created_at: number; duty_id: string | null }>('SELECT id, source, kind, title, created_at, duty_id FROM signals ORDER BY created_at DESC LIMIT ?', limit);
}

// ── Duties ──

export const getDuty = (did: string) => get<DutyRow>('SELECT * FROM duties WHERE id = ?', did);
export const listDuties = () => all<DutyRow>("SELECT * FROM duties WHERE status != 'done' ORDER BY status, created_at DESC");
export const dutyForConversation = (cid: string) => get<DutyRow>('SELECT * FROM duties WHERE conversation_id = ?', cid);

export function createDuty(input: { title: string; purpose?: string; instructions: string; autonomy?: Autonomy; notify?: 'always' | 'when_new'; restrict?: string[]; origin?: string; conversationId?: string | null; mail?: MailTrigger | null }): DutyRow {
  const d: DutyRow = {
    id: id('duty_'),
    title: truncate(input.title.trim(), 120),
    purpose: truncate((input.purpose ?? input.title).trim(), 500),
    instructions: truncate(input.instructions.trim(), 8000),
    autonomy: input.autonomy ?? 'act',
    restrict_tools: JSON.stringify(input.restrict ?? ALWAYS_ASK),
    notify: input.notify ?? 'when_new',
    memory: null,
    conversation_id: input.conversationId ?? null,
    status: 'active',
    origin: input.origin ?? 'user',
    mail: input.mail && (input.mail.from || input.mail.subject) ? JSON.stringify(input.mail) : null,
    created_at: now(),
    last_run: null,
    runs: 0,
  };
  run(
    'INSERT INTO duties (id, title, purpose, instructions, autonomy, restrict_tools, notify, memory, conversation_id, status, origin, mail, created_at, runs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    d.id, d.title, d.purpose, d.instructions, d.autonomy, d.restrict_tools, d.notify, d.memory, d.conversation_id, d.status, d.origin, d.mail, d.created_at,
  );
  emit({ type: 'duty.changed' });
  return d;
}

export function updateDuty(did: string, patch: Partial<Pick<DutyRow, 'title' | 'purpose' | 'instructions' | 'autonomy' | 'notify' | 'memory' | 'status'>> & { mail?: MailTrigger | null }) {
  const d = getDuty(did);
  if (!d) return;
  const next = { ...d, ...patch, mail: patch.mail === undefined ? d.mail : patch.mail && (patch.mail.from || patch.mail.subject) ? JSON.stringify(patch.mail) : null };
  run(
    'UPDATE duties SET title = ?, purpose = ?, instructions = ?, autonomy = ?, notify = ?, memory = ?, status = ?, mail = ? WHERE id = ?',
    next.title, next.purpose, next.instructions, next.autonomy, next.notify, next.memory ? truncate(next.memory, 4000) : null, next.status, next.mail, did,
  );
  // Pausing a duty pauses what wakes it on a timer.
  if (patch.status) run('UPDATE schedules SET enabled = ? WHERE duty_id = ? AND next_run IS NOT NULL', patch.status === 'active' ? 1 : 0, did);
  emit({ type: 'duty.changed' });
  return getDuty(did);
}

export function deleteDuty(did: string) {
  run('DELETE FROM schedules WHERE duty_id = ?', did);
  run('UPDATE watchers SET duty_id = NULL WHERE duty_id = ?', did);
  run('UPDATE hooks SET duty_id = NULL WHERE duty_id = ?', did);
  const ok = run('DELETE FROM duties WHERE id = ?', did).changes > 0;
  emit({ type: 'duty.changed' });
  emit({ type: 'schedule.changed' });
  return ok;
}

/** What wakes a duty, in words: "Daily 07:30", "Watcher: AirPods price", "Mail from sam@…". */
export function dutyTriggers(d: DutyRow): string[] {
  const out: string[] = [];
  for (const s of all<{ id: string; kind: string; spec: string; enabled: number; next_run: number | null }>('SELECT id, kind, spec, enabled, next_run FROM schedules WHERE duty_id = ?', d.id)) {
    const sp = parseJson<{ time?: string; weekday?: number; every_minutes?: number; at?: string }>(s.spec, {});
    const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    out.push(
      s.kind === 'daily' ? `Daily ${sp.time}` : s.kind === 'weekly' ? `${days[sp.weekday ?? 1]} ${sp.time}` : s.kind === 'interval' ? `Every ${sp.every_minutes} min` : s.next_run ? `Once, ${fmt(s.next_run)}` : 'Once (done)',
    );
  }
  for (const w of all<{ title: string }>('SELECT title FROM watchers WHERE duty_id = ?', d.id)) out.push(`Watcher: ${w.title}`);
  for (const h of all<{ name: string }>('SELECT name FROM hooks WHERE duty_id = ?', d.id)) out.push(`Webhook: ${h.name}`);
  const m = parseJson<MailTrigger | null>(d.mail, null);
  if (m) out.push(`Mail${m.from ? ` from ${m.from}` : ''}${m.subject ? ` about “${m.subject}”` : ''}`);
  return out;
}

/** Lessons from the user's feedback on this duty's sources (Less / Never / More). */
function lessonsFor(d: DutyRow): string {
  const sources = [
    `duty:${d.id}`,
    `chat:${d.conversation_id}`,
    ...all<{ id: string }>('SELECT id FROM schedules WHERE duty_id = ?', d.id).map((s) => `schedule:${s.id}`),
    ...all<{ id: string }>('SELECT id FROM watchers WHERE duty_id = ?', d.id).map((w) => `watch:${w.id}`),
    ...all<{ id: string }>('SELECT id FROM hooks WHERE duty_id = ?', d.id).map((h) => `hook:${h.id}`),
  ];
  const prefs = all<{ source: string; level: number }>(`SELECT source, level FROM attention_prefs WHERE level != 0 AND source IN (${sources.map(() => '?').join(',')})`, ...sources);
  if (!prefs.length) return '';
  const worst = Math.min(...prefs.map((p) => p.level));
  const best = Math.max(...prefs.map((p) => p.level));
  if (worst === -2) return 'The user muted notifications from this duty: keep working, but use verdict "log" at most.';
  if (worst === -1) return 'The user said "less like this" about this duty: only tell them about things that clearly matter; prefer "digest".';
  if (best === 1) return 'The user said "more like this" about this duty: tell them about meaningful changes promptly.';
  return '';
}

const AUTONOMY_NOTE: Record<Autonomy, string> = {
  act: 'You may act on your own for this duty (sending, buying and deleting still ask the user).',
  suggest: "Don't change anything yourself for this duty: look, then suggest what to do (the user decides). Use the verdict to bring suggestions to them.",
  watch: 'Only observe and report for this duty. Never change anything.',
};

/** Wake a duty with a signal: its own chat, its memory, its rules. Returns the run id, if one started. */
export function runDuty(did: string, sig: Signal): string | undefined {
  const d = getDuty(did);
  if (!d) return;
  recordSignal(sig, d.id);
  if (d.status !== 'active') return;
  let cid = d.conversation_id;
  if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid)) {
    cid = createConversation(`◆ ${d.title}`, 'duty');
    run('UPDATE duties SET conversation_id = ? WHERE id = ?', cid, d.id);
  }
  const lessons = lessonsFor(d);
  const how =
    d.notify === 'always'
      ? 'The user wants the result every time: finish with verdict "tell" (or "digest" if it can wait) and the result as headline and body.'
      : 'Only bring the user something new that matters: if nothing changed, finish with "silent"; otherwise "tell" or "digest" with what changed.';
  const text = `[Duty: ${d.title} · ${d.id}]
Your responsibility: ${d.purpose}

${d.instructions}

What woke you (${sig.kind}, ${fmt(now())}): ${sig.title}${sig.body ? `\n${sig.body}` : ''}

What you remembered last time: ${d.memory ? `\n${d.memory}` : 'nothing yet (first run).'}
${lessons ? `\n${lessons}\n` : ''}
(${AUTONOMY_NOTE[d.autonomy]} ${how} Put in "remember" what you need next time to know what's new: values seen, what you already told the user, open questions. If something essential is missing, ask the user one short question with notify; their answer arrives in this chat.)`;
  const target = cid;
  const attempt = (n: number): string | undefined => {
    if (activeRunFor(target)) {
      if (n < 30) setTimeout(() => attempt(n + 1), 20_000).unref?.();
      return;
    }
    try {
      const rid = startRun(target, text, 'schedule');
      run('UPDATE duties SET last_run = ?, runs = runs + 1 WHERE id = ?', now(), d.id);
      emit({ type: 'duty.changed' });
      return rid;
    } catch (err) {
      console.error(`[duty ${d.id}]`, errorMessage(err));
    }
  };
  return attempt(0);
}

/** Approvals for a duty's runs: "act" approves its steps except the always-ask tools. */
export function dutyPreapproval(conversationId: string): { restrict: string[] } | null {
  const d = dutyForConversation(conversationId);
  if (!d || d.autonomy !== 'act') return null;
  return { restrict: parseJson<string[]>(d.restrict_tools, ALWAYS_ASK) };
}

// ── Mail as a signal ──

/** New mail (Sable mail or a watched mailbox): wake every duty whose mail trigger matches. */
export function mailSignal(from: string, subject: string, details: string) {
  const sig: Signal = { source: `mail:${from.toLowerCase()}`, kind: 'mail', title: `Mail from ${from}: ${subject}`, body: details };
  let woke = 0;
  for (const d of all<DutyRow>("SELECT * FROM duties WHERE status = 'active' AND mail IS NOT NULL")) {
    const m = parseJson<MailTrigger>(d.mail, {});
    const okFrom = !m.from || from.toLowerCase().includes(m.from.toLowerCase());
    const okSubject = !m.subject || subject.toLowerCase().includes(m.subject.toLowerCase());
    if (okFrom && okSubject) {
      runDuty(d.id, sig);
      woke++;
    }
  }
  if (!woke) recordSignal(sig);
}

// ── Adopting what already exists ──

/**
 * Routines, watchers with instructions and webhooks with instructions each become a duty (once).
 * Safe to call any time; only adopts what has no duty yet.
 */
export function adoptAll() {
  for (const s of all<{ id: string; title: string; prompt: string; notify: string | null; kind: string; autonomy: string | null; restrict_tools: string | null; conversation_id: string | null }>(
    'SELECT id, title, prompt, notify, kind, autonomy, restrict_tools, conversation_id FROM schedules WHERE duty_id IS NULL',
  )) {
    const d = createDuty({
      title: s.title,
      instructions: s.prompt,
      autonomy: s.autonomy === 'auto' ? 'act' : 'suggest',
      notify: (s.notify as 'always' | 'when_new' | null) ?? (s.kind === 'interval' ? 'when_new' : 'always'),
      restrict: parseJson<string[]>(s.restrict_tools, ALWAYS_ASK),
      origin: 'routine',
      conversationId: s.conversation_id,
    });
    run('UPDATE schedules SET duty_id = ? WHERE id = ?', d.id, s.id);
  }
  for (const w of all<{ id: string; title: string; actions: string; autonomy: string | null; restrict_tools: string | null; run_conversation_id: string | null }>(
    'SELECT id, title, actions, autonomy, restrict_tools, run_conversation_id FROM watchers WHERE duty_id IS NULL',
  )) {
    const a = parseJson<{ prompt?: string; deliver?: string }>(w.actions, {});
    if (!a.prompt || a.deliver === 'here') continue; // plain alerts and "wake this chat" watchers stay as they are
    const d = createDuty({ title: w.title, instructions: a.prompt, autonomy: w.autonomy === 'auto' ? 'act' : 'suggest', notify: 'when_new', restrict: parseJson<string[]>(w.restrict_tools, ALWAYS_ASK), origin: 'watcher', conversationId: w.run_conversation_id });
    run('UPDATE watchers SET duty_id = ? WHERE id = ?', d.id, w.id);
  }
  for (const h of all<{ id: string; name: string; action: string; conversation_id: string | null }>('SELECT id, name, action, conversation_id FROM hooks WHERE duty_id IS NULL')) {
    const a = parseJson<{ prompt?: string; here?: string }>(h.action, {});
    if (!a.prompt || a.here) continue;
    const d = createDuty({ title: h.name, instructions: a.prompt, autonomy: 'suggest', notify: 'when_new', origin: 'webhook', conversationId: h.conversation_id });
    run('UPDATE hooks SET duty_id = ? WHERE id = ?', d.id, h.id);
  }
}

/** One line per active duty, for the system prompt. */
export function dutiesLine(): string {
  const list = all<DutyRow>("SELECT * FROM duties WHERE status = 'active' ORDER BY last_run DESC LIMIT 15");
  if (!list.length) return 'Duties (ongoing responsibilities): none yet.';
  return `Duties (ongoing responsibilities you run in the background): ${list.map((d) => `${d.title} [${d.autonomy}; ${dutyTriggers(d).join(', ') || 'no trigger'}; ${d.id}]`).join('; ')}`;
}
