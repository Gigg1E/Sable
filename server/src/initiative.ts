import { addLesson, lessonsBlock, observe, updateLesson } from './learning.js';
import { updateDuty } from './duties.js';
import { planLine } from './plan.js';
import { all, get, kvGet, kvSet, run } from './db.js';
import { emit } from './events.js';
import { getSettings } from './settings.js';
import { activeRunFor, createConversation, startRun } from './agent/runner.js';
import { journalForPrompt } from './brain.js';
import { isQuiet } from './attention.js';
import { fmt, localIso, parts } from './clock.js';
import { dutiesLine, recentSignals, ALWAYS_ASK } from './duties.js';
import { errorMessage, id, now, parseJson, truncate } from './util.js';

/**
 * Initiative: Sable prompts itself (docs/design/autonomy.md §4).
 *
 * A heartbeat every few waking hours, and soon after notable signals (new mail, a calendar change,
 * a webhook). Sable looks around (journal, open loops, calendar, mail, duties, what happened since
 * last time) and writes itself an agenda:
 *   - does low-risk things now and records them as "Done for you" (sending, buying, deleting still ask);
 *   - suggests the rest as Inbox cards: Do it / Not now / Never;
 *   - proposes new duties when it notices a pattern.
 * A daily budget caps how often it runs, and it never runs in quiet hours.
 */

export interface InitiativeSettings {
  enabled: boolean;
  everyHours: number;
  /** Most heartbeats a day (each is one model run). */
  dailyBudget: number;
  /** act: does low-risk things itself; suggest: only proposes. */
  autonomy: 'act' | 'suggest';
}
export const defaultInitiative = (): InitiativeSettings => ({ enabled: true, everyHours: 3, dailyBudget: 8, autonomy: 'act' });
export const initiativeCfg = (): InitiativeSettings => ({ ...defaultInitiative(), ...(getSettings().initiative ?? {}) });

// ── Suggestions ──

export interface Suggestion {
  id: string;
  title: string;
  why: string;
  action: string;
  kind: 'task' | 'duty' | 'lesson' | 'duty_edit';
  /** For lesson and duty_edit proposals: what accepting applies. */
  payload: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'never';
  key: string;
  conversation_id: string | null;
  created_at: number;
  decided_at: number | null;
}

const keyOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

export function addSuggestion(input: { title: string; why: string; action: string; kind?: Suggestion['kind']; payload?: unknown }): { ok: true; id: string } | { ok: false; reason: string } {
  const key = keyOf(input.title);
  const prev = get<Suggestion>('SELECT * FROM suggestions WHERE key = ? ORDER BY created_at DESC LIMIT 1', key);
  if (prev?.status === 'never') return { ok: false, reason: 'The user said never to this. Drop it.' };
  if (prev?.status === 'pending') return { ok: false, reason: 'Already suggested; it is waiting for the user.' };
  if (prev?.status === 'declined' && now() - (prev.decided_at ?? 0) < 7 * 86_400_000) return { ok: false, reason: 'The user said "not now" to this recently. Wait at least a week, or until something changes.' };
  if (prev?.status === 'accepted' && now() - (prev.decided_at ?? 0) < 3 * 86_400_000) return { ok: false, reason: 'The user accepted this recently; it is being handled.' };
  const sid = id('sug_');
  run(
    "INSERT INTO suggestions (id, title, why, action, kind, status, key, created_at, payload) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
    sid, truncate(input.title, 140), truncate(input.why, 600), truncate(input.action, 2000), input.kind ?? 'task', key, now(), input.payload === undefined ? null : JSON.stringify(input.payload),
  );
  emit({ type: 'suggestion.changed' });
  return { ok: true, id: sid };
}

export const pendingSuggestions = () => all<Suggestion>("SELECT * FROM suggestions WHERE status = 'pending' ORDER BY created_at DESC");

/** You decided. "Do it" starts the work in its own chat, pre-approved like a duty that acts. */
export function decideSuggestion(sid: string, decision: 'accept' | 'decline' | 'never'): Suggestion | undefined {
  const s = get<Suggestion>('SELECT * FROM suggestions WHERE id = ?', sid);
  if (!s || s.status !== 'pending') return s;
  const isIdea = s.kind === 'task' || s.kind === 'duty';
  observe(isIdea ? 'idea' : 'proposal', `${decision === 'accept' ? 'Accepted' : decision === 'never' ? 'Said NEVER to' : 'Said not now to'} ${isIdea ? 'the idea' : 'the proposed change'} "${s.title}"`, isIdea ? 'initiative' : 'review');
  if (decision !== 'accept') {
    run('UPDATE suggestions SET status = ?, decided_at = ? WHERE id = ?', decision === 'never' ? 'never' : 'declined', now(), sid);
    emit({ type: 'suggestion.changed' });
    return get<Suggestion>('SELECT * FROM suggestions WHERE id = ?', sid);
  }
  // A proposal from the self-review: accepting applies it directly.
  if (!isIdea) {
    applyProposal(s.kind, parseJson<Record<string, unknown>>(s.payload, {}));
    run("UPDATE suggestions SET status = 'accepted', decided_at = ? WHERE id = ?", now(), sid);
    emit({ type: 'suggestion.changed' });
    return get<Suggestion>('SELECT * FROM suggestions WHERE id = ?', sid);
  }
  const cid = createConversation(`✦ ${s.title}`, 'suggestion');
  run("UPDATE suggestions SET status = 'accepted', decided_at = ?, conversation_id = ? WHERE id = ?", now(), cid, sid);
  emit({ type: 'suggestion.changed' });
  const text = `[You accepted Sable's suggestion: ${s.title}]\n${s.action}\n\n(Why Sable suggested it: ${s.why})${s.kind === 'duty' ? '\n(Set it up with duty_create.)' : ''}\nWhen you're done, finish with a short verdict: "log" if it's done and routine, "tell" if the user needs to see the result.`;
  try {
    startRun(cid, text, 'schedule');
  } catch (err) {
    console.error('[suggestion]', errorMessage(err));
  }
  return get<Suggestion>('SELECT * FROM suggestions WHERE id = ?', sid);
}

/** Conversations whose runs act within the safe limits: the heartbeat, and suggestions you accepted. */
export function initiativePreapproval(conversationId: string): { restrict: string[] } | null {
  const c = get<{ kind: string }>('SELECT kind FROM conversations WHERE id = ?', conversationId);
  if (c?.kind === 'suggestion') return { restrict: ALWAYS_ASK };
  if (c?.kind === 'initiative') return initiativeCfg().autonomy === 'act' ? { restrict: ALWAYS_ASK } : null;
  return null;
}

// ── The heartbeat ──

const today = () => {
  const p = parts(now());
  return `${p.y}-${p.mo}-${p.d}`;
};
function applyProposal(kind: Suggestion['kind'], p: Record<string, unknown>) {
  if (kind === 'lesson') {
    if (p.retire_id) updateLesson(String(p.retire_id), { status: 'retired' });
    if (p.text) addLesson(String(p.scope ?? 'all'), String(p.text), 'review');
  } else if (kind === 'duty_edit' && p.duty_id) {
    const field = String(p.field);
    if (field === 'instructions' || field === 'purpose' || field === 'title') updateDuty(String(p.duty_id), { [field]: String(p.after) });
    else if (field === 'notify' && (p.after === 'always' || p.after === 'when_new')) updateDuty(String(p.duty_id), { notify: p.after });
  }
}

const usedToday = () => kvGet<{ day: string; n: number }>('initiative_used')?.day === today() ? kvGet<{ day: string; n: number }>('initiative_used')!.n : 0;

function chatId(): string {
  let cid = kvGet<string>('initiative_chat');
  if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid)) {
    cid = createConversation('✦ Check-ins', 'initiative');
    kvSet('initiative_chat', cid);
  }
  return cid;
}

function prompt(reason: string): string {
  const last = kvGet<number>('initiative_last') ?? 0;
  const signals = recentSignals(40).filter((s) => s.created_at > last);
  const decided = all<Suggestion>("SELECT * FROM suggestions WHERE status IN ('declined', 'never', 'accepted') AND kind IN ('task', 'duty') ORDER BY decided_at DESC LIMIT 15");
  const pending = pendingSuggestions();
  const done = all<{ title: string; created_at: number }>("SELECT title, created_at FROM notifications WHERE kind = 'done' ORDER BY created_at DESC LIMIT 10");
  const acts = initiativeCfg().autonomy === 'act';
  return `[Check-in: ${reason} · ${fmt(now())}]
You're checking in on your own, without being asked. Look after the user like a sharp chief of staff would: notice what needs doing before they have to ask.

Look at (with your tools as needed): today's and tomorrow's calendar; recent important mail; the journal and open loops below; duties and their state; what happened since your last check-in (below).

Then:
${acts ? `1. DO small, low-risk, clearly-wanted things yourself now: set a reminder before an early event, add an open loop or journal note, prepare a summary or a draft (don't send it), file something into the Library, update a duty's memory. After each one, call done_for_you with what you did. Sending, buying and deleting will ask the user: don't do those here, suggest them instead.` : '1. Do NOT change anything yourself. Only look.'}
1b. PLAN: keep today's and tomorrow's plan sensible. Put your own follow-ups and prep at sensible times with plan_add (who "sable"), and, when the user has something to get done (an assignment, an errand) and free time for it, block time for them (who "you"). Don't overbook them; respect their calendar.
2. SUGGEST anything bigger, anything that sends/buys/deletes, or anything you're not sure they want: suggest(title, why, action). action is exactly what you'll do if they tap "Do it". kind "duty" when it should be an ongoing responsibility (you noticed them asking about the same thing repeatedly, a deadline series, a package, a bill).
3. Don't repeat yourself: skip anything already pending, done recently, or declined (lists below). At most 3 suggestions per check-in. Quality over quantity: nothing is a perfectly fine outcome.
4. End with finish: "silent" if you did and found nothing; "log" if you only did small things; "digest" for a one-line summary worth their next digest; "tell" only if something needs them today.

${journalForPrompt()}
${dutiesLine()}
${planLine()}

Since your last check-in${last ? ` (${fmt(last)})` : ''}: ${signals.length ? signals.map((s) => `${s.kind}: ${s.title}`).join('; ') : 'nothing recorded'}.
Waiting for the user: ${pending.length ? pending.map((s) => s.title).join('; ') : 'nothing'}.
${lessonsBlock('initiative', 'plan')}
Recently decided: ${decided.length ? decided.map((s) => `${s.title} (${s.status === 'never' ? 'NEVER suggest again' : s.status})`).join('; ') : 'nothing'}.
Done for them recently: ${done.length ? done.map((d) => d.title).join('; ') : 'nothing'}.
Local time now: ${localIso(now())}.`;
}

/** Start a check-in now (if allowed). Returns why not, or the run id. */
export function checkIn(reason = 'scheduled check-in', force = false): { runId?: string; skipped?: string } {
  const cfg = initiativeCfg();
  if (!cfg.enabled && !force) return { skipped: 'Initiative is off.' };
  if (!force && isQuiet()) return { skipped: 'Quiet hours.' };
  if (!force && usedToday() >= cfg.dailyBudget) return { skipped: `Today's budget of ${cfg.dailyBudget} check-ins is used.` };
  const cid = chatId();
  if (activeRunFor(cid)) return { skipped: 'A check-in is already running.' };
  try {
    const rid = startRun(cid, prompt(reason), 'schedule');
    kvSet('initiative_last', now());
    kvSet('initiative_ran', now());
    kvSet('initiative_used', { day: today(), n: usedToday() + 1 });
    kvSet('initiative_nudged', 0);
    emit({ type: 'initiative.changed' });
    return { runId: rid };
  } catch (err) {
    return { skipped: errorMessage(err) };
  }
}

/** A notable signal arrived: check in soon (debounced). */
export function nudgeInitiative() {
  if (!kvGet<number>('initiative_nudged')) kvSet('initiative_nudged', now());
}

export function initiativeStatus() {
  const cfg = initiativeCfg();
  const last = kvGet<number>('initiative_ran') ?? null;
  const timer = kvGet<number>('initiative_last') ?? null;
  return { ...cfg, last, usedToday: usedToday(), next: timer ? timer + cfg.everyHours * 3600_000 : null, chat: kvGet<string>('initiative_chat') ?? null, pending: pendingSuggestions().length };
}

export function startInitiative() {
  const tick = () => {
    const cfg = initiativeCfg();
    if (!cfg.enabled || isQuiet()) return;
    const last = kvGet<number>('initiative_last') ?? 0;
    const nudged = kvGet<number>('initiative_nudged') ?? 0;
    // On a timer, or 10 minutes after something notable happened (but not more than every 45 minutes).
    if (now() - last >= cfg.everyHours * 3600_000) checkIn('scheduled check-in');
    else if (nudged && now() - nudged >= 10 * 60_000 && now() - last >= 45 * 60_000) checkIn('something new came in');
  };
  setInterval(tick, 60_000).unref?.();
  // First check-in a few minutes after start, not immediately (lets everything settle).
  if (!kvGet<number>('initiative_last')) kvSet('initiative_last', now() - Math.max(0, initiativeCfg().everyHours * 3600_000 - 5 * 60_000));
}
