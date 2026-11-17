import { all, get, run } from '../../db.js';
import { emit } from '../../events.js';
import { notify } from '../../push.js';
import { id, now, parseJson } from '../../util.js';
import { registerTool } from './registry.js';

// ───────────────────────────── Memory ─────────────────────────────

export interface MemoryRow {
  id: string;
  content: string;
  source: string | null;
  created_at: number;
  updated_at: number;
}

export function listMemories(limit = 200): MemoryRow[] {
  return all<MemoryRow>('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?', limit);
}

registerTool({
  name: 'memory_save',
  label: 'Remember',
  group: 'Memory',
  description:
    'Save a durable fact or preference about the user (e.g. "Prefers aisle seats", "Daughter Mia is allergic to peanuts"). One fact per call. Only save things that will matter later.',
  parameters: { type: 'object', properties: { content: { type: 'string', description: 'The fact, in one short sentence.' } }, required: ['content'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Remember: ${a.content}`,
  async run(a, ctx) {
    const mid = id('m_');
    run('INSERT INTO memories (id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', mid, String(a.content).trim(), ctx.agent, now(), now());
    emit({ type: 'memory.changed' });
    return `Saved memory ${mid}.`;
  },
});

registerTool({
  name: 'memory_search',
  label: 'Search memory',
  group: 'Memory',
  description: 'Search saved memories about the user by keywords. Returns matching memories with their ids.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Search memory for "${a.query}"`,
  async run(a) {
    const words = String(a.query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const rows = listMemories(1000)
      .map((m) => ({ m, score: words.filter((w) => m.content.toLowerCase().includes(w)).length }))
      .filter((x) => x.score > 0 || !words.length)
      .sort((x, y) => y.score - x.score)
      .slice(0, 20);
    return rows.length ? rows.map((r) => `[${r.m.id}] ${r.m.content}`).join('\n') : 'No matching memories.';
  },
});

registerTool({
  name: 'memory_forget',
  label: 'Forget',
  group: 'Memory',
  description: 'Delete a saved memory by id. Use when the user asks you to forget something or a fact is outdated.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Forget memory ${a.id}`,
  async run(a) {
    const res = run('DELETE FROM memories WHERE id = ?', String(a.id));
    emit({ type: 'memory.changed' });
    return res.changes ? 'Forgotten.' : 'No memory with that id.';
  },
});

// ───────────────────────────── Goals ─────────────────────────────

export interface GoalStep {
  text: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
  note?: string;
}
export interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  steps: string;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
}

export function goalJson(g: GoalRow) {
  return { ...g, steps: parseJson<GoalStep[]>(g.steps, []) };
}

function emitGoal(goalId: string) {
  const g = get<GoalRow>('SELECT * FROM goals WHERE id = ?', goalId);
  if (g) emit({ type: 'goal.changed', goal: goalJson(g) });
}

registerTool({
  name: 'goal_create',
  label: 'Create goal',
  group: 'Goals',
  description:
    'Start tracking a multi-step job as a goal with an ordered plan. Use for anything that takes more than two or three actions or may continue in the background.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' }, description: 'Ordered plan, one short step each.' },
    },
    required: ['title', 'steps'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `New goal: ${a.title}`,
  async run(a, ctx) {
    const gid = id('g_');
    const steps: GoalStep[] = (a.steps as string[]).map((text) => ({ text: String(text), status: 'pending' }));
    run(
      'INSERT INTO goals (id, title, description, status, steps, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      gid, String(a.title), String(a.description ?? ''), 'active', JSON.stringify(steps), ctx.conversationId, now(), now(),
    );
    emitGoal(gid);
    return `Goal ${gid} created with ${steps.length} steps (indexes 0-${steps.length - 1}).`;
  },
});

registerTool({
  name: 'goal_update',
  label: 'Update goal',
  group: 'Goals',
  description: 'Update a goal: mark steps in_progress/done/skipped (by index), add steps, or set the goal status (active, done, blocked, cancelled).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['active', 'done', 'blocked', 'cancelled'] },
      steps: {
        type: 'array',
        description: 'Step updates',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped'] },
            note: { type: 'string' },
          },
          required: ['index', 'status'],
        },
      },
      add_steps: { type: 'array', items: { type: 'string' } },
    },
    required: ['id'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Update goal ${a.id}`,
  async run(a) {
    const g = get<GoalRow>('SELECT * FROM goals WHERE id = ?', String(a.id));
    if (!g) return 'No goal with that id.';
    const steps = parseJson<GoalStep[]>(g.steps, []);
    for (const u of (a.steps ?? []) as { index: number; status: GoalStep['status']; note?: string }[]) {
      if (steps[u.index]) {
        steps[u.index].status = u.status;
        if (u.note) steps[u.index].note = u.note;
      }
    }
    for (const text of (a.add_steps ?? []) as string[]) steps.push({ text, status: 'pending' });
    let status = a.status ?? g.status;
    if (!a.status && steps.length && steps.every((s) => s.status === 'done' || s.status === 'skipped')) status = 'done';
    run('UPDATE goals SET steps = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify(steps), status, now(), g.id);
    emitGoal(g.id);
    const done = steps.filter((s) => s.status === 'done').length;
    return `Goal updated: ${done}/${steps.length} steps done, status ${status}.`;
  },
});

registerTool({
  name: 'goal_list',
  label: 'List goals',
  group: 'Goals',
  description: 'List goals that are not finished, with their steps.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const goals = all<GoalRow>("SELECT * FROM goals WHERE status IN ('active','blocked') ORDER BY updated_at DESC LIMIT 20").map(goalJson);
    if (!goals.length) return 'No active goals.';
    return goals
      .map((g) => `${g.id} — ${g.title} [${g.status}]\n` + g.steps.map((s, i) => `  ${i}. [${s.status}] ${s.text}`).join('\n'))
      .join('\n\n');
  },
});

// ───────────────────────────── Spaces ─────────────────────────────

registerTool({
  name: 'space_create',
  label: 'Build space',
  group: 'Spaces',
  description:
    'Build a Space: a small self-contained app (tracker, dashboard, planner, mood board, checklist…) the user can pin and reopen. Provide a complete HTML document body with inline <style> and <script>. Persist data with `await sable.get(key)` / `await sable.set(key, value)` (JSON values), read everything with `await sable.all()`, and ask the agent with `await sable.ask(prompt)` (returns text). Scripts may load libraries from cdn.jsdelivr.net or cdnjs.cloudflare.com; there is no other network access. Use ONLY the CSS variables --bg, --surface, --surface-2, --fg, --muted, --subtle, --accent, --ok, --danger, --border, --radius for colors (e.g. color: var(--fg); background: var(--surface)) so it works in both light and dark mode: never hard-code colors like #000, black, white or #fff for text or backgrounds. Aim for a calm, tool-like look: 1px borders, small radii, generous spacing, no gradients or emoji decoration, and make it responsive.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      icon: { type: 'string', description: 'A single emoji' },
      html: { type: 'string' },
      data: { type: 'object', description: 'Optional initial data (key → JSON value)' },
    },
    required: ['title', 'html'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Build space “${a.title}”`,
  async run(a, ctx) {
    const sid = id('s_');
    run(
      'INSERT INTO spaces (id, title, description, icon, html, data, pinned, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      sid, String(a.title), String(a.description ?? ''), String(a.icon ?? '✨'), String(a.html), JSON.stringify(a.data ?? {}), ctx.conversationId, now(), now(),
    );
    emit({ type: 'space.changed', id: sid, conversationId: ctx.conversationId });
    return `Space ${sid} created. The user can open it from Spaces.`;
  },
});

registerTool({
  name: 'space_update',
  label: 'Update space',
  group: 'Spaces',
  description: 'Update a Space: replace its html, title or description, and/or merge keys into its stored data.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      html: { type: 'string' },
      data: { type: 'object', description: 'Keys to merge into the stored data' },
    },
    required: ['id'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Update space ${a.id}`,
  async run(a, ctx) {
    const s = get<{ id: string; data: string }>('SELECT id, data FROM spaces WHERE id = ?', String(a.id));
    if (!s) return 'No space with that id.';
    const data = { ...parseJson<Record<string, unknown>>(s.data, {}), ...((a.data as object) ?? {}) };
    run(
      'UPDATE spaces SET title = COALESCE(?, title), description = COALESCE(?, description), html = COALESCE(?, html), data = ?, updated_at = ? WHERE id = ?',
      (a.title as string) ?? null, (a.description as string) ?? null, (a.html as string) ?? null, JSON.stringify(data), now(), s.id,
    );
    emit({ type: 'space.changed', id: s.id, conversationId: ctx.conversationId });
    return 'Space updated.';
  },
});

registerTool({
  name: 'space_list',
  label: 'List spaces',
  group: 'Spaces',
  description: 'List Spaces (id, title, description, data keys). Use space_read to see one in full.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const rows = all<{ id: string; title: string; description: string; data: string }>('SELECT id, title, description, data FROM spaces ORDER BY updated_at DESC');
    if (!rows.length) return 'No spaces yet.';
    return rows.map((r) => `${r.id} — ${r.title}: ${r.description} (data keys: ${Object.keys(parseJson(r.data, {})).join(', ') || 'none'})`).join('\n');
  },
});

registerTool({
  name: 'space_read',
  label: 'Read space',
  group: 'Spaces',
  description: "Read a Space's html and stored data.",
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  async run(a) {
    const s = get<{ title: string; html: string; data: string }>('SELECT title, html, data FROM spaces WHERE id = ?', String(a.id));
    if (!s) return 'No space with that id.';
    return `# ${s.title}\n\n## data\n${s.data}\n\n## html\n${s.html}`;
  },
});

// ───────────────────────────── Notify ─────────────────────────────

registerTool({
  name: 'notify',
  label: 'Notify',
  group: 'Notify',
  description: "Send the user a push notification (phone/desktop). Use for results of background or scheduled work, or when something needs the user's attention.",
  parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Notify: ${a.title}`,
  async run(a, ctx) {
    await notify({ title: String(a.title), body: String(a.body ?? ''), link: `/chat/${ctx.conversationId}`, kind: 'agent' });
    return 'Notification sent.';
  },
});

// ───────────────────────────── Schedules ─────────────────────────────

export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';
export interface ScheduleSpec {
  at?: string;
  every_minutes?: number;
  time?: string;
  weekday?: number;
}

/** Next fire time strictly after `from`, or null if the schedule is finished. */
export function computeNextRun(kind: ScheduleKind, spec: ScheduleSpec, from = now()): number | null {
  if (kind === 'once') {
    const t = Date.parse(spec.at ?? '');
    return Number.isFinite(t) && t > from ? t : null;
  }
  if (kind === 'interval') return from + Math.max(5, Number(spec.every_minutes) || 60) * 60_000;
  const [h, m] = (spec.time ?? '09:00').split(':').map(Number);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(h || 0, m || 0);
  if (kind === 'daily') {
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const weekday = Number(spec.weekday ?? 1);
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() <= from) add = 7;
  d.setDate(d.getDate() + add);
  return d.getTime();
}

registerTool({
  name: 'schedule_create',
  label: 'Schedule task',
  group: 'Schedules',
  description:
    'Schedule work to run in the background later or on repeat. At each run the agent receives `prompt` as an instruction. kind: once (at = ISO date-time), interval (every_minutes ≥ 5), daily (time = "HH:MM"), weekly (time + weekday 0=Sun..6=Sat). Times are in the server\'s local time zone.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      prompt: { type: 'string', description: 'What to do each time it runs. Include "notify me with the result" if the user should hear back.' },
      kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly'] },
      at: { type: 'string' },
      every_minutes: { type: 'number' },
      time: { type: 'string' },
      weekday: { type: 'integer' },
    },
    required: ['title', 'prompt', 'kind'],
  },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Schedule “${a.title}” (${a.kind}${a.time ? ' ' + a.time : ''}${a.at ? ' ' + a.at : ''}${a.every_minutes ? ' every ' + a.every_minutes + 'm' : ''})`,
  async run(a, ctx) {
    const spec: ScheduleSpec = { at: a.at, every_minutes: a.every_minutes, time: a.time, weekday: a.weekday };
    const next = computeNextRun(a.kind, spec);
    if (next == null) return 'That time is in the past or invalid; nothing scheduled.';
    const sid = id('sch_');
    run(
      'INSERT INTO schedules (id, title, prompt, kind, spec, next_run, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      sid, String(a.title), String(a.prompt), String(a.kind), JSON.stringify(spec), next, now(),
    );
    emit({ type: 'schedule.changed', conversationId: ctx.conversationId });
    return `Scheduled ${sid}; next run ${new Date(next).toString()}.`;
  },
});

registerTool({
  name: 'schedule_list',
  label: 'List schedules',
  group: 'Schedules',
  description: 'List scheduled background tasks.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const rows = all<{ id: string; title: string; kind: string; spec: string; next_run: number | null; enabled: number }>('SELECT * FROM schedules ORDER BY created_at DESC');
    if (!rows.length) return 'No schedules.';
    return rows.map((r) => `${r.id} — ${r.title} [${r.kind} ${r.spec}] ${r.enabled ? 'next ' + (r.next_run ? new Date(r.next_run).toString() : '—') : 'disabled'}`).join('\n');
  },
});

registerTool({
  name: 'schedule_delete',
  label: 'Delete schedule',
  group: 'Schedules',
  description: 'Delete a scheduled task by id.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Delete schedule ${a.id}`,
  async run(a) {
    const res = run('DELETE FROM schedules WHERE id = ?', String(a.id));
    emit({ type: 'schedule.changed' });
    return res.changes ? 'Deleted.' : 'No schedule with that id.';
  },
});
