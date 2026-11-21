import { all, get, kvGet, run } from './db.js';
import { emit } from './events.js';
import { notify } from './push.js';
import { activeRunFor, createConversation, startRun, wakeChat } from './agent/runner.js';
import { computeNextRun, type ScheduleKind, type ScheduleSpec } from './agent/tools/personal.js';
import { eventsBetween } from './agent/tools/calendar.js';
import { defaultAttention, isQuiet } from './attention.js';
import { fmt, fmtTime, parts, wallToUtc } from './clock.js';
import { initiativeCfg } from './initiative.js';
import { getSettings } from './settings.js';
import { errorMessage, id, now, parseJson, truncate } from './util.js';

/**
 * Sable's plan, and the agenda hub (docs/design/plan.md).
 *
 * Plan items are things scheduled at a time, for one of two people:
 *   who = sable  something Sable will do itself then ("check the refund status", "draft the weekly report")
 *   who = you    time Sable blocked out for the user ("math assignment, 8–10 pm"): at the start it nudges
 *                you, and the next check-in follows up.
 *
 * The agenda merges everything that will happen in a range into one timeline: plan items, duty
 * timers, reminders, follow-ups, check-ins and digests, plus the user's own calendar for context,
 * and an "always on" list (watchers, webhooks, mail triggers). It's what the Plan page shows.
 */

export type Who = 'sable' | 'you';
export interface PlanItem {
  id: string;
  who: Who;
  title: string;
  notes: string | null;
  start_at: number;
  end_at: number | null;
  status: 'planned' | 'done' | 'skipped';
  duty_id: string | null;
  conversation_id: string | null;
  origin: string;
  fired_at: number | null;
  created_at: number;
}

export function addPlanItem(input: { who: Who; title: string; notes?: string; start: number; end?: number | null; dutyId?: string | null; conversationId?: string | null; origin?: string }): PlanItem {
  const p: PlanItem = {
    id: id('pl_'),
    who: input.who,
    title: truncate(input.title.trim(), 160),
    notes: input.notes?.trim() ? truncate(input.notes.trim(), 4000) : null,
    start_at: input.start,
    end_at: input.end ?? null,
    status: 'planned',
    duty_id: input.dutyId ?? null,
    conversation_id: input.conversationId ?? null,
    origin: input.origin ?? 'chat',
    fired_at: null,
    created_at: now(),
  };
  run(
    'INSERT INTO plan_items (id, who, title, notes, start_at, end_at, status, duty_id, conversation_id, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    p.id, p.who, p.title, p.notes, p.start_at, p.end_at, p.status, p.duty_id, p.conversation_id, p.origin, p.created_at,
  );
  emit({ type: 'plan.changed' });
  return p;
}

/** Only the fields that were actually given (undefined means "leave as is"). */
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export const getPlanItem = (pid: string) => get<PlanItem>('SELECT * FROM plan_items WHERE id = ?', pid);

export function updatePlanItem(pid: string, patch: Partial<Pick<PlanItem, 'title' | 'notes' | 'start_at' | 'end_at' | 'status' | 'who'>>) {
  const p = getPlanItem(pid);
  if (!p) return;
  const n = { ...p, ...defined(patch) };
  // Moving an item re-arms it.
  const fired = patch.start_at !== undefined && patch.start_at !== p.start_at ? null : p.fired_at;
  run('UPDATE plan_items SET who = ?, title = ?, notes = ?, start_at = ?, end_at = ?, status = ?, fired_at = ? WHERE id = ?', n.who, n.title, n.notes, n.start_at, n.end_at, n.status, fired, pid);
  emit({ type: 'plan.changed' });
  return getPlanItem(pid);
}

export function deletePlanItem(pid: string) {
  const ok = run('DELETE FROM plan_items WHERE id = ?', pid).changes > 0;
  if (ok) emit({ type: 'plan.changed' });
  return ok;
}

export const planBetween = (from: number, to: number) => all<PlanItem>('SELECT * FROM plan_items WHERE start_at >= ? AND start_at < ? ORDER BY start_at', from, to);

/** Today's plan, for prompts: what Sable will do, and what it's making sure the user does. */
export function planLine(): string {
  const p = parts(now());
  const from = wallToUtc(p.y, p.mo, p.d, 0, 0);
  const to = wallToUtc(p.y, p.mo, p.d + 2, 0, 0);
  const items = planBetween(from, to).filter((i) => i.status === 'planned');
  if (!items.length) return 'Plan (today and tomorrow): nothing planned yet.';
  const line = (i: PlanItem) => `${fmt(i.start_at, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${i.end_at ? `–${fmtTime(i.end_at)}` : ''} ${i.title} [${i.id}]`;
  const mine = items.filter((i) => i.who === 'sable');
  const theirs = items.filter((i) => i.who === 'you');
  return `Plan (today and tomorrow). Yours to do: ${mine.length ? mine.map(line).join('; ') : 'nothing'}. Time blocked for the user: ${theirs.length ? theirs.map(line).join('; ') : 'nothing'}.`;
}

// ── Firing ──

function planChat(): string {
  const existing = get<{ id: string }>("SELECT id FROM conversations WHERE kind = 'plan' ORDER BY created_at LIMIT 1");
  return existing?.id ?? createConversation('✦ Plan', 'plan');
}

function fire(p: PlanItem) {
  if (!run('UPDATE plan_items SET fired_at = ? WHERE id = ? AND fired_at IS NULL', now(), p.id).changes) return;
  emit({ type: 'plan.changed' });
  if (p.who === 'you') {
    // Your time block starts: a nudge, and the chat it came from hears about it.
    void notify({
      title: `Now: ${p.title}`,
      body: `${p.end_at ? `Until ${fmtTime(p.end_at)}. ` : ''}${p.notes ?? ''}`.trim(),
      link: '/plan',
      kind: 'reminder',
      verdict: 'urgent',
      source: 'plan:you',
      key: `plan:${p.id}`,
    });
    return;
  }
  const text = `[Planned task: ${p.title} · ${p.id}]\n${p.notes ?? ''}\n\n(You planned this for now. Do it, then call plan_update with status "done" (or "skipped" and why), and end with finish: "log" if routine, "tell" if the user needs the result.)`;
  if (p.conversation_id && get('SELECT id FROM conversations WHERE id = ?', p.conversation_id) && !activeRunFor(p.conversation_id)) {
    if (wakeChat(p.conversation_id, text)) return;
  }
  try {
    startRun(planChat(), text, 'schedule');
  } catch (err) {
    console.error('[plan]', errorMessage(err));
  }
}

export function startPlan() {
  const tick = () => {
    for (const p of all<PlanItem>("SELECT * FROM plan_items WHERE status = 'planned' AND fired_at IS NULL AND start_at <= ? AND start_at > ?", now(), now() - 6 * 3600_000)) fire(p);
  };
  setInterval(tick, 20_000).unref?.();
  setTimeout(tick, 4_000).unref?.();
}

/** Plan items Sable runs act within the same safe limits as its check-ins. */
export function isPlanChat(conversationId: string) {
  return get<{ kind: string }>('SELECT kind FROM conversations WHERE id = ?', conversationId)?.kind === 'plan';
}

// ── The agenda ──

export interface AgendaItem {
  key: string;
  kind: 'plan' | 'duty' | 'reminder' | 'followup' | 'checkin' | 'digest' | 'event';
  who: Who;
  title: string;
  at: number;
  end?: number | null;
  detail?: string;
  status?: string;
  /** What the Plan page can do with it. */
  ref?: { type: 'plan' | 'schedule' | 'reminder' | 'duty'; id: string };
  approx?: boolean;
  allDay?: boolean;
}
export interface AlwaysOn {
  kind: 'watcher' | 'webhook' | 'mail' | 'interval';
  title: string;
  detail: string;
  link: string;
}

/** Every occurrence of a timer between from and to (capped). */
function occurrences(kind: ScheduleKind, spec: ScheduleSpec, nextRun: number | null, from: number, to: number): number[] {
  const out: number[] = [];
  if (kind === 'once') return nextRun && nextRun >= from && nextRun < to ? [nextRun] : [];
  let t = nextRun ?? computeNextRun(kind, spec, from - 1);
  for (let i = 0; t != null && t < to && i < 60; i++) {
    if (t >= from) out.push(t);
    t = computeNextRun(kind, spec, t);
  }
  return out;
}

function projectedCheckins(from: number, to: number): number[] {
  const cfg = initiativeCfg();
  if (!cfg.enabled) return [];
  const out: number[] = [];
  let t = (kvGet<number>('initiative_last') ?? now()) + cfg.everyHours * 3600_000;
  const perDay = new Map<string, number>();
  for (let i = 0; t < to && i < 200; i++, t += cfg.everyHours * 3600_000) {
    if (t < from || isQuiet(t)) continue;
    const p = parts(t);
    const day = `${p.y}-${p.mo}-${p.d}`;
    const n = perDay.get(day) ?? 0;
    if (n >= cfg.dailyBudget) continue;
    perDay.set(day, n + 1);
    out.push(t);
  }
  return out;
}

export async function buildAgenda(from: number, to: number, withCalendar = true): Promise<{ items: AgendaItem[]; alwaysOn: AlwaysOn[]; calendarErrors: string[] }> {
  const items: AgendaItem[] = [];
  const alwaysOn: AlwaysOn[] = [];

  for (const p of planBetween(from, to)) {
    items.push({ key: `plan:${p.id}`, kind: 'plan', who: p.who, title: p.title, at: p.start_at, end: p.end_at, detail: p.notes ?? undefined, status: p.status, ref: { type: 'plan', id: p.id } });
  }

  // Duty timers (and any routine not adopted yet).
  for (const s of all<{ id: string; title: string; kind: ScheduleKind; spec: string; next_run: number | null; enabled: number; duty_id: string | null }>('SELECT id, title, kind, spec, next_run, enabled, duty_id FROM schedules WHERE enabled = 1')) {
    const spec = parseJson<ScheduleSpec>(s.spec, {});
    const title = s.duty_id ? (get<{ title: string }>('SELECT title FROM duties WHERE id = ?', s.duty_id)?.title ?? s.title) : s.title;
    if (s.kind === 'interval' && (spec.every_minutes ?? 60) < 6 * 60) {
      alwaysOn.push({ kind: 'interval', title, detail: `Every ${spec.every_minutes} min`, link: '/duties' });
      continue;
    }
    for (const t of occurrences(s.kind, spec, s.next_run, from, to)) {
      items.push({ key: `sch:${s.id}:${t}`, kind: 'duty', who: 'sable', title, at: t, ref: s.duty_id ? { type: 'duty', id: s.duty_id } : { type: 'schedule', id: s.id }, detail: s.kind === 'once' ? 'Once' : s.kind === 'daily' ? 'Every day' : s.kind === 'weekly' ? 'Every week' : `Every ${spec.every_minutes} min` });
    }
  }

  for (const r of all<{ id: string; text: string; note: string | null; due_at: number; wake: number }>('SELECT id, text, note, due_at, wake FROM reminders WHERE due_at >= ? AND due_at < ?', from, to)) {
    items.push({ key: `rem:${r.id}`, kind: r.wake ? 'followup' : 'reminder', who: r.wake ? 'sable' : 'you', title: r.text, at: r.due_at, detail: r.note ?? undefined, ref: { type: 'reminder', id: r.id } });
  }

  for (const t of projectedCheckins(from, to)) items.push({ key: `chk:${t}`, kind: 'checkin', who: 'sable', title: 'Check-in', at: t, approx: true, detail: 'Looks around: calendar, mail, open loops, duties' });

  // Digests: only the ones that will actually carry something are worth showing today; show the times lightly.
  const att = { ...defaultAttention(), ...(getSettings().attention ?? {}) };
  const p0 = parts(from);
  for (let d = 0; d < 8; d++) {
    for (const hm of [att.quietEnd, ...att.digestTimes]) {
      const [h, m] = hm.split(':').map(Number);
      const t = wallToUtc(p0.y, p0.mo, p0.d + d, h || 0, m || 0);
      if (t >= from && t < to) items.push({ key: `dig:${t}`, kind: 'digest', who: 'sable', title: 'Digest', at: t, detail: 'Anything that could wait, in one notification' });
    }
  }

  let calendarErrors: string[] = [];
  if (withCalendar) {
    try {
      const { events, errors } = await eventsBetween(new Date(from), new Date(to), { signal: AbortSignal.timeout(8000) });
      calendarErrors = errors;
      for (const e of events.slice(0, 300)) items.push({ key: `ev:${+e.start}:${e.title}`, kind: 'event', who: 'you', title: e.title, at: +e.start, end: +e.end, allDay: e.allDay, detail: [e.location, e.calendar].filter(Boolean).join(' · ') });
    } catch (err) {
      calendarErrors = [errorMessage(err)];
    }
  }

  for (const w of all<{ title: string; interval_min: number; source: string | null }>('SELECT title, interval_min, source FROM watchers WHERE enabled = 1')) {
    alwaysOn.push({ kind: 'watcher', title: w.title, detail: w.source && w.source !== 'web' ? `Watching ${w.source}` : `Checks every ${w.interval_min >= 60 ? `${Math.round(w.interval_min / 60)} h` : `${w.interval_min} min`}`, link: '/watchers' });
  }
  for (const h of all<{ name: string; count: number }>('SELECT name, count FROM hooks WHERE enabled = 1')) alwaysOn.push({ kind: 'webhook', title: h.name, detail: `Listening · ${h.count} received`, link: '/webhooks' });
  for (const d of all<{ title: string; mail: string }>("SELECT title, mail FROM duties WHERE status = 'active' AND mail IS NOT NULL")) {
    const m = parseJson<{ from?: string; subject?: string }>(d.mail, {});
    alwaysOn.push({ kind: 'mail', title: d.title, detail: `Mail${m.from ? ` from ${m.from}` : ''}${m.subject ? ` about “${m.subject}”` : ''}`, link: '/duties' });
  }

  items.sort((a, b) => a.at - b.at);
  return { items, alwaysOn, calendarErrors };
}
