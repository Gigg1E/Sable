import { activeRunFor, createConversation, startRun } from './agent/runner.js';
import { computeNextRun, type ScheduleKind, type ScheduleSpec } from './agent/tools/personal.js';
import { all, get, run } from './db.js';
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
  const next = computeNextRun(s.kind, parseJson<ScheduleSpec>(s.spec, {}));
  run('UPDATE schedules SET last_run = ?, next_run = ?, enabled = ? WHERE id = ?', now(), next, next == null ? 0 : 1, s.id);
  emit({ type: 'schedule.changed' });
  try {
    return startRun(cid, `[Scheduled task: ${s.title}]\n${s.prompt}`, 'schedule');
  } catch (err) {
    console.error(`[schedule ${s.id}]`, errorMessage(err));
  }
}

export function startScheduler() {
  const tick = () => {
    for (const s of all<{ id: string }>('SELECT id FROM schedules WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?', now())) {
      fireSchedule(s.id);
    }
  };
  setInterval(tick, 20_000).unref();
  setTimeout(tick, 3_000).unref();
}
