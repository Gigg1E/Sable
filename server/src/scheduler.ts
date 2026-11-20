import { activeRunFor, createConversation, startRun } from './agent/runner.js';
import { computeNextRun, type ScheduleKind, type ScheduleSpec } from './agent/tools/personal.js';
import { all, get, run } from './db.js';
import { defaultNotify } from './agent/automation.js';
import { emit } from './events.js';
import { errorMessage, now, parseJson } from './util.js';

interface ScheduleRow {
  id: string;
  title: string;
  prompt: string;
  kind: ScheduleKind;
  spec: string;
  next_run: number | null;
  conversation_id: string | null;
  notify: string | null;
  last_result: string | null;
  last_run: number | null;
}

/** Fire one schedule now: runs in its own conversation so results stay together. */
export function fireSchedule(sid: string): string | undefined {
  const s = get<ScheduleRow>('SELECT * FROM schedules WHERE id = ?', sid);
  if (!s) return;
  let cid = s.conversation_id;
  if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid)) {
    cid = createConversation(`⏰ ${s.title}`, 'schedule');
    run('UPDATE schedules SET conversation_id = ? WHERE id = ?', cid, s.id);
  }
  if (activeRunFor(cid)) return; // previous run still going; try next tick
  const previousRun = s.last_run;
  const next = computeNextRun(s.kind, parseJson<ScheduleSpec>(s.spec, {}));
  run('UPDATE schedules SET last_run = ?, next_run = ?, enabled = ? WHERE id = ?', now(), next, next == null ? 0 : 1, s.id);
  emit({ type: 'schedule.changed' });
  try {
    const mode = s.notify ?? defaultNotify(s.kind);
    const how =
      mode === 'when_new'
        ? `This is an automatic check that runs ${s.kind === 'interval' ? 'repeatedly' : 'on a schedule'}. The user ONLY wants to hear about something new. If nothing new happened since the last check, do NOT call notify, and reply with one short line starting "Nothing new". If something new happened, reply with what's new (it will be sent to the user).`
        : 'Reply with the result for the user; it will be sent to them as a notification.';
    const missing = ' If you can\'t finish because something is missing or unclear, call notify with one short question; the user\'s answer will arrive in this chat and you can finish then.';
    const last = s.last_result ? `\n\nLast check (${new Date(previousRun ?? now()).toLocaleString()}):\n${s.last_result.slice(0, 800)}` : '';
    return startRun(cid, `[Scheduled task: ${s.title} · ${s.id}]\n${s.prompt}\n\n(${how}${missing})${last}`, 'schedule');
  } catch (err) {
    console.error(`[schedule ${s.id}]`, errorMessage(err));
  }
}

export function startScheduler() {
  const tick = () => {
    // One-time routines disappear a day after they ran (their history chat stays).
    run("DELETE FROM schedules WHERE kind = 'once' AND enabled = 0 AND last_run IS NOT NULL AND last_run < ?", now() - 86_400_000);
    for (const s of all<{ id: string }>('SELECT id FROM schedules WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?', now())) {
      fireSchedule(s.id);
    }
  };
  setInterval(tick, 20_000).unref();
  setTimeout(tick, 3_000).unref();
}
