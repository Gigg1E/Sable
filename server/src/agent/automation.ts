import { get, run } from '../db.js';

/**
 * Guard rails for background work, enforced in code rather than left to the model:
 * a check that found nothing new must not ping the user, and the same news is never sent twice.
 */

/** Replies that only say nothing happened ("No new emails yet", "Price unchanged", …). */
export function saysNothingNew(text: string): boolean {
  const head = text.replace(/[#*_>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240).toLowerCase();
  if (!head) return true;
  return (
    /^(nothing( new)?|no (new|change|changes|update|updates|news)|unchanged|still (no|nothing|waiting)|not yet|no[,.]?\s+(\w+\s+){0,3}(yet|hasn't|has not))\b/.test(head) ||
    /\b(no new (emails?|messages?|updates?|results?|replies|activity)|nothing (new|has changed|to report)|(hasn't|has not|haven't|have not|didn't|did not) (changed?|arrived|come in|sent|replied|been updated)|no changes? (since|detected|found|to report)|still (no|nothing|hasn't|has not|unchanged)|(is|remains) unchanged|not (arrived|received) yet)\b/.test(head)
  );
}

const norm = (s: string) => s.toLowerCase().replace(/\d{1,2}:\d{2}(\s?[ap]m)?|\d{4}-\d{2}-\d{2}[t ][\d:.z+-]*/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Runs that already sent their own notification (so the automatic one isn't a duplicate). */
const notifiedRuns = new Set<string>();
export const markNotified = (runId: string) => void notifiedRuns.add(runId);
export const consumeNotified = (runId: string) => notifiedRuns.delete(runId);

export type NotifyMode = 'always' | 'when_new';
export interface ScheduleInfo {
  id: string;
  title: string;
  kind: string;
  notify: NotifyMode | null;
  last_result: string | null;
}
export const defaultNotify = (kind: string): NotifyMode => (kind === 'interval' ? 'when_new' : 'always');

export function scheduleForConversation(conversationId: string): ScheduleInfo | undefined {
  return get<ScheduleInfo>('SELECT id, title, kind, notify, last_result FROM schedules WHERE conversation_id = ?', conversationId);
}

/**
 * Decide whether the end of a background run should notify the user.
 * Remembers the result so the next check can tell what's new.
 */
export function shouldNotifyAfterRun(conversationId: string, runId: string, answer: string): boolean {
  const agentNotified = consumeNotified(runId);
  const s = scheduleForConversation(conversationId);
  if (!s) return !agentNotified;
  const mode = s.notify ?? defaultNotify(s.kind);
  const previous = s.last_result;
  run('UPDATE schedules SET last_result = ? WHERE id = ?', answer.slice(0, 2000), s.id);
  if (agentNotified) return false;
  if (mode === 'always') return true;
  if (saysNothingNew(answer)) return false;
  return !previous || norm(previous) !== norm(answer);
}

/** Guard for the notify tool itself during a "only when something's new" check. */
export function blockNotify(conversationId: string, title: string, body: string): string | null {
  const s = scheduleForConversation(conversationId);
  if (s && (s.notify ?? defaultNotify(s.kind)) === 'when_new' && saysNothingNew(`${title}. ${body}`))
    return "Not sent: this check only notifies when something new happens, and there's nothing new. That's expected. Finish quietly with one short line.";
  const last = get<{ title: string; body: string | null; created_at: number }>(
    'SELECT title, body, created_at FROM notifications WHERE link = ? ORDER BY created_at DESC LIMIT 1',
    `/chat/${conversationId}`,
  );
  if (last && Date.now() - last.created_at < 12 * 3600_000 && norm(`${last.title} ${last.body ?? ''}`) === norm(`${title} ${body}`)) return 'Not sent: the user already got this exact notification recently.';
  return null;
}

/**
 * Approving a routine approves the steps its runs take ("autonomy: auto"), except tools that
 * always need a person (purchases) and anything the user restricted when approving it.
 */
export interface Preapproval {
  restrict: string[];
}
export function preapprovalFor(conversationId: string): Preapproval | null {
  const row =
    get<{ autonomy: string | null; restrict_tools: string | null }>('SELECT autonomy, restrict_tools FROM schedules WHERE conversation_id = ?', conversationId) ??
    get<{ autonomy: string | null; restrict_tools: string | null }>('SELECT autonomy, restrict_tools FROM watchers WHERE run_conversation_id = ?', conversationId);
  if (!row || row.autonomy !== 'auto') return null;
  let restrict: string[] = [];
  try {
    restrict = JSON.parse(row.restrict_tools ?? '[]');
  } catch {
    /* none */
  }
  return { restrict };
}
export function isRestricted(p: Preapproval, toolName: string) {
  return p.restrict.some((r) => r && toolName.toLowerCase().includes(r.toLowerCase()));
}
