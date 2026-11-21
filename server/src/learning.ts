import { all, get, kvGet, kvSet, run } from './db.js';
import { emit } from './events.js';
import { getSettings } from './settings.js';
import { activeRunFor, createConversation, startRun } from './agent/runner.js';
import { isQuiet } from './attention.js';
import { fmt } from './clock.js';
import { errorMessage, id, now, truncate } from './util.js';

/**
 * Learning: Sable gets better on its own (docs/design/autonomy.md §5).
 *
 * Observations are the raw material: your Less / More / Never, ideas you accepted or turned down,
 * corrections in chat, plan items you moved or removed, what you said about the plan.
 *
 * Lessons are what Sable takes from them: short rules with a scope ("all", "initiative", "plan",
 * "duty:<id>") that go into the prompts where they apply.
 *
 * Once a week (and on demand) Sable reviews itself: observations, how each duty did, failing tools.
 * It proposes new lessons and edits to its duties; you accept or reject each in the Inbox.
 * Nothing about how it behaves changes without you.
 */

export interface Lesson {
  id: string;
  scope: string;
  text: string;
  origin: string;
  status: 'active' | 'retired';
  created_at: number;
  updated_at: number;
}

export function observe(kind: string, text: string, scope = 'all') {
  run('INSERT INTO observations (id, kind, text, scope, created_at) VALUES (?, ?, ?, ?, ?)', id('obs_'), kind, truncate(text, 600), scope, now());
  run('DELETE FROM observations WHERE id IN (SELECT id FROM observations ORDER BY created_at DESC LIMIT -1 OFFSET 1000)');
}

export const listLessons = (status: 'active' | 'retired' | 'all' = 'active') =>
  status === 'all' ? all<Lesson>('SELECT * FROM lessons ORDER BY updated_at DESC') : all<Lesson>('SELECT * FROM lessons WHERE status = ? ORDER BY updated_at DESC', status);

export function addLesson(scope: string, text: string, origin = 'review'): Lesson {
  const l: Lesson = { id: id('les_'), scope: scope || 'all', text: truncate(text.trim(), 400), origin, status: 'active', created_at: now(), updated_at: now() };
  run('INSERT INTO lessons (id, scope, text, origin, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', l.id, l.scope, l.text, l.origin, l.status, l.created_at, l.updated_at);
  emit({ type: 'lesson.changed' });
  return l;
}
export function updateLesson(lid: string, patch: { text?: string; status?: 'active' | 'retired'; scope?: string }) {
  const l = get<Lesson>('SELECT * FROM lessons WHERE id = ?', lid);
  if (!l) return;
  run('UPDATE lessons SET text = ?, status = ?, scope = ?, updated_at = ? WHERE id = ?', patch.text?.trim() || l.text, patch.status ?? l.status, patch.scope ?? l.scope, now(), lid);
  emit({ type: 'lesson.changed' });
  return get<Lesson>('SELECT * FROM lessons WHERE id = ?', lid);
}
export function deleteLesson(lid: string) {
  const ok = run('DELETE FROM lessons WHERE id = ?', lid).changes > 0;
  emit({ type: 'lesson.changed' });
  return ok;
}

/** Lessons for a prompt: everything for "all", plus the given scopes. */
export function lessonsBlock(...scopes: string[]): string {
  const want = ['all', ...scopes];
  const list = all<Lesson>(`SELECT * FROM lessons WHERE status = 'active' AND scope IN (${want.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 25`, ...want);
  if (!list.length) return '';
  return `Lessons you've learned from the user (follow them):\n${list.map((l) => `- ${l.text}`).join('\n')}`;
}

// ── The weekly self-review ──

export interface LearningSettings {
  enabled: boolean;
  everyDays: number;
}
export const learningCfg = (): LearningSettings => ({ enabled: true, everyDays: 7, ...(getSettings().learning ?? {}) });

function reviewChat(): string {
  let cid = kvGet<string>('review_chat');
  if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid)) {
    cid = createConversation('✦ Self-review', 'review');
    kvSet('review_chat', cid);
  }
  return cid;
}

function reviewPrompt(): string {
  const since = kvGet<number>('review_last') ?? now() - 7 * 86_400_000;
  const obs = all<{ kind: string; text: string; scope: string; created_at: number }>('SELECT kind, text, scope, created_at FROM observations WHERE created_at > ? ORDER BY created_at LIMIT 120', since);
  const lessons = listLessons('active');
  const duties = all<{ id: string; title: string; purpose: string; instructions: string; autonomy: string; notify: string; runs: number; memory: string | null }>("SELECT id, title, purpose, instructions, autonomy, notify, runs, memory FROM duties WHERE status = 'active'");
  const verdicts = (src: string) =>
    all<{ verdict: string; n: number; fb: string | null }>('SELECT verdict, COUNT(*) AS n, MAX(feedback) AS fb FROM notifications WHERE source = ? AND created_at > ? GROUP BY verdict', src, since)
      .map((v) => `${v.n} ${v.verdict}${v.fb ? ` (feedback: ${v.fb})` : ''}`)
      .join(', ') || 'no notifications';
  const toolErrors = all<{ tool_name: string; n: number }>("SELECT tool_name, COUNT(*) AS n FROM messages WHERE role = 'tool' AND is_error = 1 AND created_at > ? GROUP BY tool_name ORDER BY n DESC LIMIT 10", since);
  const ideas = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM suggestions WHERE created_at > ? AND kind IN ('task', 'duty') GROUP BY status", since);
  return `[Self-review · ${fmt(now())}]
Review how you've been doing for the user since ${fmt(since)}, and propose how to do better. You change nothing yourself here: every change is a proposal the user accepts or rejects.

Propose, each with a short why:
- lesson_propose: a short, concrete rule learned from what the user did or said (scope "all", "initiative", "plan" or "duty:<id>"). Only when the evidence supports it; never invent preferences. Don't repeat existing lessons; propose retiring ones that are wrong or outdated (lesson_propose with retire_id).
- duty_propose_edit: a better version of a duty's instructions, purpose or notify setting, when its record shows it's noisy, unhelpful or failing.
- If a tool keeps failing, say so in your final summary (and suggest a fix if you can see one).
At most 5 proposals. Fewer, well-founded ones are better. If nothing needs to change, propose nothing.
End with finish: "digest" with a 1–2 line summary of what you found, or "silent" if there was nothing.

What happened (observations):
${obs.length ? obs.map((o) => `- ${fmt(o.created_at)} [${o.kind}, ${o.scope}] ${o.text}`).join('\n') : '- nothing recorded'}

Current lessons:
${lessons.length ? lessons.map((l) => `- ${l.id} [${l.scope}] ${l.text}`).join('\n') : '- none yet'}

Duties:
${duties.length ? duties.map((d) => `- ${d.id} "${d.title}" [${d.autonomy}, notify ${d.notify}, ${d.runs} runs; ${verdicts(`duty:${d.id}`)}]\n  purpose: ${d.purpose}\n  instructions: ${truncate(d.instructions, 400)}\n  memory: ${d.memory ? truncate(d.memory, 200) : '(empty)'}`).join('\n') : '- none'}

Ideas from check-ins: ${ideas.length ? ideas.map((i) => `${i.n} ${i.status}`).join(', ') : 'none'}.
Failing tools: ${toolErrors.length ? toolErrors.map((t) => `${t.tool_name} ×${t.n}`).join(', ') : 'none'}.`;
}

export function runReview(force = false): { runId?: string; skipped?: string } {
  const cfg = learningCfg();
  if (!force && !cfg.enabled) return { skipped: 'Self-review is off.' };
  if (!force && isQuiet()) return { skipped: 'Quiet hours.' };
  const cid = reviewChat();
  if (activeRunFor(cid)) return { skipped: 'A review is already running.' };
  try {
    const prompt = reviewPrompt();
    const rid = startRun(cid, prompt, 'schedule');
    kvSet('review_last', now());
    emit({ type: 'lesson.changed' });
    return { runId: rid };
  } catch (err) {
    return { skipped: errorMessage(err) };
  }
}

export function learningStatus() {
  const cfg = learningCfg();
  const last = kvGet<number>('review_last') ?? null;
  return { ...cfg, last, next: (last ?? kvGet<number>('review_first') ?? now()) + cfg.everyDays * 86_400_000, chat: kvGet<string>('review_chat') ?? null, observations: get<{ n: number }>('SELECT COUNT(*) AS n FROM observations WHERE created_at > ?', last ?? 0)?.n ?? 0 };
}

export function startLearning() {
  if (!kvGet<number>('review_first')) kvSet('review_first', now());
  const tick = () => {
    const cfg = learningCfg();
    if (!cfg.enabled) return;
    const due = (kvGet<number>('review_last') ?? kvGet<number>('review_first')!) + cfg.everyDays * 86_400_000;
    // Only worth a model run when something happened since the last one.
    const fresh = get<{ n: number }>('SELECT COUNT(*) AS n FROM observations WHERE created_at > ?', kvGet<number>('review_last') ?? 0)?.n ?? 0;
    if (now() >= due && fresh > 0) runReview();
  };
  setInterval(tick, 30 * 60_000).unref?.();
}
