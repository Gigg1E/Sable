import { all, get, run } from './db.js';
import { emit } from './events.js';
import { notify } from './push.js';
import { errorMessage, id, now } from './util.js';

/**
 * Reminders: one-off "remind me at 10pm about class". A time and a message, nothing else. When it's
 * due you get a notification and the reminder is gone. No model call, no approval, no clutter in
 * Routines. (Recurring things and one-off *jobs* the agent has to do are routines.)
 */

export interface Reminder {
  id: string;
  text: string;
  note: string | null;
  due_at: number;
  conversation_id: string | null;
  created_at: number;
}

export function listReminders(): Reminder[] {
  return all<Reminder>('SELECT * FROM reminders ORDER BY due_at');
}

/** "now", an ISO time, or minutes from now. Returns a ms timestamp or an error message. */
export function parseDue(at?: unknown, inMinutes?: unknown): number | string {
  const mins = Number(inMinutes);
  if (inMinutes != null && inMinutes !== '' && Number.isFinite(mins)) {
    if (mins < 1) return 'in_minutes must be at least 1.';
    return now() + Math.round(mins * 60_000);
  }
  if (typeof at !== 'string' || !at.trim()) return 'Give the time as at (ISO date-time) or in_minutes.';
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return `"${at}" isn't a date-time I can read. Use ISO, e.g. 2026-11-20T22:00.`;
  if (t < now() - 60_000) return `${new Date(t).toLocaleString()} is in the past. Ask the user for the right time.`;
  return t;
}

export function createReminder(input: { text: string; note?: string; due: number; conversationId?: string }): Reminder {
  const r: Reminder = { id: id('rem_'), text: input.text.trim().slice(0, 200), note: input.note?.trim().slice(0, 1000) || null, due_at: input.due, conversation_id: input.conversationId ?? null, created_at: now() };
  run('INSERT INTO reminders (id, text, note, due_at, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', r.id, r.text, r.note, r.due_at, r.conversation_id, r.created_at);
  emit({ type: 'reminder.changed', conversationId: r.conversation_id ?? undefined });
  return r;
}

export function updateReminder(rid: string, patch: { text?: string; note?: string | null; due?: number }): Reminder | undefined {
  const cur = get<Reminder>('SELECT * FROM reminders WHERE id = ?', rid);
  if (!cur) return;
  run('UPDATE reminders SET text = ?, note = ?, due_at = ? WHERE id = ?', patch.text?.trim() || cur.text, patch.note === undefined ? cur.note : patch.note, patch.due ?? cur.due_at, rid);
  emit({ type: 'reminder.changed' });
  return get<Reminder>('SELECT * FROM reminders WHERE id = ?', rid);
}

export function deleteReminder(rid: string) {
  const ok = run('DELETE FROM reminders WHERE id = ?', rid).changes > 0;
  if (ok) emit({ type: 'reminder.changed' });
  return ok;
}

/** "Tonight 10:00 PM", "Tomorrow 9:00 AM", "Sat, Nov 22, 7:30 PM". */
export function whenText(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  if (diff === 0) return `${d.getHours() >= 17 ? 'Tonight' : 'Today'} ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fire(r: Reminder) {
  // Delete first, so a slow push service can't make it fire twice.
  if (!run('DELETE FROM reminders WHERE id = ?', r.id).changes) return;
  emit({ type: 'reminder.changed' });
  const late = now() - r.due_at > 5 * 60_000 ? ` (was due ${whenText(r.due_at)}; Sable was offline)` : '';
  void notify({ title: `⏰ ${r.text}`, body: `${r.note ?? ''}${late}`.trim(), link: r.conversation_id ? `/chat/${r.conversation_id}` : '/routines', kind: 'reminder' }).catch((err) =>
    console.error(`[reminder ${r.id}]`, errorMessage(err)),
  );
}

export function startReminders() {
  const tick = () => {
    for (const r of all<Reminder>('SELECT * FROM reminders WHERE due_at <= ?', now())) fire(r);
  };
  // Every 10 s so a reminder lands on the minute it's set for.
  setInterval(tick, 10_000).unref();
  setTimeout(tick, 2_000).unref();
}
