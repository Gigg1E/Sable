import { all, get, run } from '../../db.js';
import { emit } from '../../events.js';
import { notify } from '../../push.js';
import { id, now, parseJson } from '../../util.js';
import { blockNotify, defaultNotify, markNotified } from '../automation.js';
import { registerTool } from './registry.js';
import { cosine, embed, overlap, words } from '../helpers.js';

// ───────────────────────────── Memory ─────────────────────────────
// Two kinds: "me" (facts about the user: where they live, preferences, routines of life) and
// "other" (people, places, accounts, things: "Sam is my landlord, sam@example.com").
// "Me" memories are always in context; "other" ones only when relevant to the message.

export interface MemoryRow {
  id: string;
  content: string;
  source: string | null;
  kind: 'me' | 'other' | 'howto';
  embedding: string | null;
  created_at: number;
  updated_at: number;
}

export function listMemories(limit = 200): MemoryRow[] {
  return all<MemoryRow>('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?', limit);
}

/** Things that are tasks or instructions, not facts: those belong in routines/watchers, not memory. */
function looksLikeTask(text: string) {
  return /^(please\s+)?(monitor|watch|track|check|remind|email|send|text|call|buy|order|add|set|create|schedule|notify|tell|ping|alert|follow up|keep an eye|look (up|for)|find|search|cancel|book)\b/i.test(text.trim()) ||
    /\b(remind me|notify me|let me know when|tell me when|watch (for|my)|monitor (my|this|for)|every (day|morning|hour|week))\b/i.test(text);
}

async function vectorFor(text: string): Promise<number[] | null> {
  const v = await embed([text]);
  return v?.[0] ?? null;
}

/**
 * Memories for a message: every "me" memory (up to 25), plus the "other" ones (people, things) and
 * "howto" ones (how the user wants tools used in a situation) that relate to it.
 */
export async function relevantMemories(query: string): Promise<MemoryRow[]> {
  const rows = listMemories(2000);
  const me = rows.filter((m) => m.kind === 'me' || !m.kind).slice(0, 25);
  const rest = rows.filter((m) => m.kind === 'other' || m.kind === 'howto');
  if (!rest.length || !query.trim()) return me;
  const qv = await vectorFor(query);
  const qw = words(query);
  const score = (m: MemoryRow) => {
    const v = qv && m.embedding ? parseJson<number[] | null>(m.embedding, null) : null;
    // Without a vector for both sides, keywords alone decide (with a matching lower bar).
    return { s: (v && qv ? cosine(qv, v) * 10 : 0) + overlap(qw, m.content) * 1.5, bar: v && qv ? 4 : 2.5 };
  };
  const pick = (kind: string, n: number) =>
    rest
      .filter((m) => m.kind === kind)
      .map((m) => ({ m, ...score(m) }))
      .filter((x) => x.s >= x.bar)
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.m);
  return [...me, ...pick('other', 8), ...pick('howto', 6)];
}

/** Tools a how-to memory mentions by name, so the preferred tools are loaded for the run. */
export function toolsMentioned(memories: MemoryRow[], toolNames: string[]): string[] {
  const text = memories.filter((m) => m.kind === 'howto').map((m) => m.content.toLowerCase()).join(' ');
  return toolNames.filter((n) => text.includes(n.toLowerCase()) || text.includes(n.replace(/_/g, ' ').toLowerCase()));
}

/** Fill in missing embeddings in the background (old memories, or saved while the helper was installing). */
export async function backfillMemoryEmbeddings() {
  const rows = all<MemoryRow>('SELECT * FROM memories WHERE embedding IS NULL LIMIT 200');
  if (!rows.length) return;
  const vecs = await embed(rows.map((r) => r.content));
  if (!vecs) return;
  rows.forEach((r, i) => run('UPDATE memories SET embedding = ? WHERE id = ?', JSON.stringify(vecs[i]), r.id));
}

registerTool({
  name: 'memory_save',
  label: 'Remember',
  group: 'Memory',
  description:
    'Save something lasting, one per call. kind "me": about the user (lives in Florida, vegetarian, works nights). kind "other": about people, places or things in their life (Sam is the landlord, sam@example.com; the car is a 2019 Civic). kind "howto": how the user wants a kind of request handled, learned when they correct or instruct how you use tools; write it as "When <situation>: <what to do, which tools>" (e.g. "When tracking a package: use an email watcher on the carrier\'s shipping emails, not a routine", "When posting deals: send them to the Deals Discord webhook with webhook_send"). Do NOT save one-off tasks or requests ("monitor my email" itself is a watcher, not a memory). Don\'t save details only relevant to this conversation.',
  parameters: {
    type: 'object',
    properties: { content: { type: 'string', description: 'One short sentence (howto: "When <situation>: <what to do>").' }, kind: { type: 'string', enum: ['me', 'other', 'howto'] } },
    required: ['content'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Remember: ${a.content}`,
  async run(a, ctx) {
    const content = String(a.content).trim();
    if (!content) return 'Nothing to save.';
    const kindIn = a.kind === 'other' || a.kind === 'howto' ? a.kind : 'me';
    if (kindIn === 'howto' && !/^(when|if|for|whenever|always|never|prefer|don'?t|use)\b/i.test(content))
      return 'Not saved: write a how-to as "When <situation>: <what to do and which tools>", so it applies to future requests rather than this one.';
    if (kindIn !== 'howto' && looksLikeTask(content))
      return 'Not saved: that is a task or instruction, not a fact. Automations (routines, watchers) are stored on their own; only save lasting facts about the user or the people and things in their life.';
    const kind = kindIn;
    const v = await vectorFor(content);
    // Same fact again (or an update of it): replace instead of piling up near-duplicates.
    const dup = v
      ? listMemories(2000).find((m) => m.embedding && cosine(v, parseJson<number[]>(m.embedding, [])) > 0.93)
      : listMemories(2000).find((m) => m.content.toLowerCase() === content.toLowerCase());
    if (dup) {
      run('UPDATE memories SET content = ?, kind = ?, embedding = ?, updated_at = ? WHERE id = ?', content, kind, v ? JSON.stringify(v) : dup.embedding, now(), dup.id);
      emit({ type: 'memory.changed' });
      return `Updated memory ${dup.id}.`;
    }
    const mid = id('m_');
    run('INSERT INTO memories (id, content, source, kind, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', mid, content, ctx.agent, kind, v ? JSON.stringify(v) : null, now(), now());
    emit({ type: 'memory.changed' });
    return `Saved memory ${mid}.`;
  },
});

registerTool({
  name: 'memory_search',
  label: 'Search memory',
  group: 'Memory',
  description: 'Search saved memories (about the user, and about people, places and things in their life). Returns matching memories with their ids.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Search memory for "${a.query}"`,
  async run(a) {
    const q = String(a.query);
    const qv = await vectorFor(q);
    const qw = words(q);
    const rows = listMemories(2000)
      .map((m) => ({ m, s: (qv && m.embedding ? cosine(qv, parseJson<number[]>(m.embedding, [])) * 10 : 0) + overlap(qw, m.content) * 1.5 }))
      .filter((x) => x.s >= (qv ? 3 : 1) || !qw.size)
      .sort((x, y) => y.s - x.s)
      .slice(0, 20);
    return rows.length ? rows.map((r) => `[${r.m.id}] (${r.m.kind === 'other' ? 'other' : r.m.kind === 'howto' ? 'how-to' : 'about the user'}) ${r.m.content}`).join('\n') : 'No matching memories.';
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
    'Build a Space: a live mini-app the user can pin and open beside the chat (tracker, dashboard, shopping list, planner, checklist…). Write the HTML body with your own layout, inline <style> for layout and <script> for behaviour. Sable styles it for you: plain elements (headings, buttons, inputs, tables, lists) already look right in light and dark, and these classes are ready to use: card, grid, row, col, spread, stack, list, badge (accent/ok/danger), stat (.value/.label), progress (>span width), tabs (>button.active), empty, primary/danger buttons, muted. Give it a personality with theme (accent color, radius, font, density) rather than hard-coded colors; for colors in your CSS use only var(--fg), var(--muted), var(--subtle), var(--bg), var(--surface), var(--surface-2), var(--border), var(--accent), var(--ok), var(--danger). Data: `await sable.all()`, `await sable.get(key)`, `await sable.set(key, value)` (JSON) persist it; `sable.on(key, value => …)` (or sable.on(fn) for any key) re-renders when the data changes from outside (you, watchers or routines updating it with space_data_set), so render from data and subscribe instead of hard-coding values. Buttons can call `await sable.ask(prompt)` for a quick text answer, or `sable.act(prompt)` to start a task with your tools (e.g. "check the prices of every item now and update the space"). Libraries may load from cdn.jsdelivr.net or cdnjs.cloudflare.com; there is no other network access. Make it responsive.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      icon: { type: 'string', description: 'A single emoji' },
      html: { type: 'string' },
      data: { type: 'object', description: 'Optional initial data (key → JSON value)' },
      theme: {
        type: 'object',
        description: 'Look of this space: accent (any CSS color), radius sharp|soft|round, font sans|serif|mono|rounded, density compact|comfortable|airy',
        properties: { accent: { type: 'string' }, radius: { type: 'string', enum: ['sharp', 'soft', 'round'] }, font: { type: 'string', enum: ['sans', 'serif', 'mono', 'rounded'] }, density: { type: 'string', enum: ['compact', 'comfortable', 'airy'] } },
      },

    },
    required: ['title', 'html'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Build space “${a.title}”`,
  async run(a, ctx) {
    const sid = id('s_');
    run(
      'INSERT INTO spaces (id, title, description, icon, html, data, pinned, conversation_id, created_at, updated_at, theme) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
      sid, String(a.title), String(a.description ?? ''), String(a.icon ?? '✨'), String(a.html), JSON.stringify(a.data ?? {}), ctx.conversationId, now(), now(), a.theme ? JSON.stringify(a.theme) : null,
    );
    emit({ type: 'space.changed', id: sid, conversationId: ctx.conversationId });
    return `Space ${sid} created. The user can open it from Spaces.`;
  },
});

registerTool({
  name: 'space_update',
  label: 'Update space',
  group: 'Spaces',
  description: 'Update a Space: replace its html, title, description or theme, and/or merge keys into its stored data. To change only data (prices, items, status), prefer space_data_set: it updates the open space live without reloading it.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      html: { type: 'string' },
      data: { type: 'object', description: 'Keys to merge into the stored data' },
      theme: {
        type: 'object',
        description: 'Look of this space: accent (any CSS color), radius sharp|soft|round, font sans|serif|mono|rounded, density compact|comfortable|airy',
        properties: { accent: { type: 'string' }, radius: { type: 'string', enum: ['sharp', 'soft', 'round'] }, font: { type: 'string', enum: ['sans', 'serif', 'mono', 'rounded'] }, density: { type: 'string', enum: ['compact', 'comfortable', 'airy'] } },
      },
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
      'UPDATE spaces SET title = COALESCE(?, title), description = COALESCE(?, description), html = COALESCE(?, html), data = ?, theme = COALESCE(?, theme), updated_at = ? WHERE id = ?',
      (a.title as string) ?? null, (a.description as string) ?? null, (a.html as string) ?? null, JSON.stringify(data), a.theme ? JSON.stringify(a.theme) : null, now(), s.id,
    );
    emit({ type: 'space.changed', id: s.id, conversationId: ctx.conversationId });
    return 'Space updated.';
  },
});

/** Set one data key of a space and push it to any open copy live (no reload). */
export function setSpaceData(spaceId: string, key: string, value: unknown) {
  const s = get<{ id: string; data: string }>('SELECT id, data FROM spaces WHERE id = ?', spaceId);
  if (!s) return false;
  const data = { ...parseJson<Record<string, unknown>>(s.data, {}), [key]: value };
  const json = JSON.stringify(data);
  if (json.length > 2_000_000) throw new Error('Space data is too large');
  run('UPDATE spaces SET data = ? WHERE id = ?', json, s.id);
  emit({ type: 'space.data', id: s.id, key, value });
  return true;
}

registerTool({
  name: 'space_data_set',
  label: 'Update space data',
  group: 'Spaces',
  description:
    "Set one key of a Space's data (any JSON value); the space updates live if it's open. Use it to keep spaces in sync, e.g. a watcher writing the latest price into a shopping list space. Read the current value first with space_data_get when you only change part of it.",
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Space id' }, key: { type: 'string' }, value: { description: 'Any JSON value' } }, required: ['id', 'key', 'value'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Update ${a.key} in space ${a.id}`,
  async run(a) {
    return setSpaceData(String(a.id), String(a.key), a.value) ? `Set ${a.key}.` : 'No space with that id. Use space_list.';
  },
});

registerTool({
  name: 'space_data_get',
  label: 'Read space data',
  group: 'Spaces',
  description: "Read a Space's data: one key, or all of it.",
  parameters: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Read space ${a.id}${a.key ? ` · ${a.key}` : ''}`,
  async run(a) {
    const s = get<{ data: string }>('SELECT data FROM spaces WHERE id = ?', String(a.id));
    if (!s) return 'No space with that id.';
    const data = parseJson<Record<string, unknown>>(s.data, {});
    return JSON.stringify(a.key ? (data[String(a.key)] ?? null) : data, null, 1).slice(0, 30_000);
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
    const blocked = blockNotify(ctx.conversationId, String(a.title), String(a.body ?? ''));
    if (blocked) return blocked;
    await notify({ title: String(a.title), body: String(a.body ?? ''), link: `/chat/${ctx.conversationId}`, kind: 'agent' });
    markNotified(ctx.runId);
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
  // Checks more often than every 10 minutes are almost never what anyone wants (and cost model calls).
  if (kind === 'interval') return from + Math.max(10, Number(spec.every_minutes) || 60) * 60_000;
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
    'Set a routine: a time, a topic (title) and a prompt. At each run you receive the prompt in a fresh background chat and do it: tell the user something (a reminder or briefing) or do a job yourself (e.g. "email Sam the results at 8pm", "add the dentist appointment to my calendar"). Write the prompt with every detail the run will need. If something essential is missing (the time, who to email, the subject), ask the user BEFORE creating the routine. The user reviews and approves it; once approved, its runs act without asking again except for purchases and any tools listed in restrict (e.g. ["send"] to keep asking before sending email). kind: once (at = ISO date-time), interval (every_minutes ≥ 10; use 15-60 for checks), daily (time = "HH:MM"), weekly (time + weekday 0=Sun..6=Sat). Times are in the server\'s local time zone. notify: "always" for reminders and briefings the user wants every time (default for once/daily/weekly); "when_new" for checks ("tell me when X emails me"), which only notify when something new happened and never report that nothing changed (default for interval). To change an existing schedule use schedule_update, never create a second one.',
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
      notify: { type: 'string', enum: ['always', 'when_new'] },
      restrict: { type: 'array', items: { type: 'string' }, description: 'Tool names (or parts, like "send" or "delete") that should still ask the user during runs' },
    },
    required: ['title', 'prompt', 'kind'],
  },
  risk: 'medium',
  defaultPolicy: 'ask',
  alwaysAsk: true,
  async preview(a) {
    const spec: ScheduleSpec = { at: a.at, every_minutes: a.every_minutes, time: a.time, weekday: a.weekday };
    const next = computeNextRun(a.kind, spec);
    if (next == null) return { refuse: 'That time is in the past or invalid. Ask the user for a valid time.' };
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const when =
      a.kind === 'once' ? new Date(next).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : a.kind === 'interval' ? `Every ${Math.max(10, Number(a.every_minutes) || 60)} minutes`
      : a.kind === 'daily' ? `Every day at ${a.time ?? '09:00'}`
      : `Every ${days[Number(a.weekday ?? 1)] ?? 'week'} at ${a.time ?? '09:00'}`;
    return {
      summary: `Routine “${a.title}”`,
      card: { type: 'automation', kind: 'routine', title: String(a.title), when, next, prompt: String(a.prompt), notify: a.notify ?? defaultNotify(String(a.kind)), restrict: Array.isArray(a.restrict) ? a.restrict.map(String) : [] },
    };
  },
  summarize: (a) => `Schedule “${a.title}” (${a.kind}${a.time ? ' ' + a.time : ''}${a.at ? ' ' + a.at : ''}${a.every_minutes ? ' every ' + a.every_minutes + 'm' : ''})`,
  async run(a, ctx) {
    const spec: ScheduleSpec = { at: a.at, every_minutes: a.every_minutes, time: a.time, weekday: a.weekday };
    const next = computeNextRun(a.kind, spec);
    if (next == null) return 'That time is in the past or invalid; nothing scheduled.';
    const sid = id('sch_');
    const mode = a.notify === 'always' || a.notify === 'when_new' ? a.notify : defaultNotify(String(a.kind));
    const autonomy = ctx.choice === 'ask' ? 'ask' : 'auto';
    const restrict = Array.isArray(a.restrict) ? a.restrict.map(String) : [];
    run(
      'INSERT INTO schedules (id, title, prompt, kind, spec, next_run, enabled, notify, autonomy, restrict_tools, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
      sid, String(a.title), String(a.prompt), String(a.kind), JSON.stringify(spec), next, mode, autonomy, JSON.stringify(restrict), now(),
    );
    emit({ type: 'schedule.changed', conversationId: ctx.conversationId });
    return `Scheduled ${sid}; next run ${new Date(next).toString()}. Notifies ${mode === 'always' ? 'every run' : 'only when something new happens'}. ${autonomy === 'auto' ? `Its runs act without asking${restrict.length ? ` (except: ${restrict.join(', ')})` : ''}.` : 'Its runs ask the user before each action that needs approval.'}`;
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
  name: 'schedule_update',
  label: 'Change schedule',
  group: 'Schedules',
  description:
    'Change an existing scheduled task (find its id with schedule_list): title, prompt, timing (kind with at / every_minutes / time / weekday), notify ("always" or "when_new") or enabled (false pauses it). Use this whenever the user wants an automation changed, quieter, less frequent or paused.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      prompt: { type: 'string' },
      kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly'] },
      at: { type: 'string' },
      every_minutes: { type: 'number' },
      time: { type: 'string' },
      weekday: { type: 'integer' },
      notify: { type: 'string', enum: ['always', 'when_new'] },
      enabled: { type: 'boolean' },
    },
    required: ['id'],
  },
  risk: 'medium',
  defaultPolicy: 'auto',
  summarize: (a) => `Change schedule ${a.id}`,
  async run(a, ctx) {
    const cur = get<{ id: string; kind: ScheduleKind; spec: string; enabled: number }>('SELECT id, kind, spec, enabled FROM schedules WHERE id = ?', String(a.id));
    if (!cur) return 'No schedule with that id. Use schedule_list to find it.';
    const kind = (a.kind ?? cur.kind) as ScheduleKind;
    const spec: ScheduleSpec = { ...JSON.parse(cur.spec || '{}'), ...Object.fromEntries(['at', 'every_minutes', 'time', 'weekday'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) };
    const enabled = a.enabled === undefined ? !!cur.enabled : !!a.enabled;
    const next = enabled ? computeNextRun(kind, spec) : null;
    if (enabled && next == null) return 'That time is in the past or invalid; nothing changed.';
    run(
      'UPDATE schedules SET title = COALESCE(?, title), prompt = COALESCE(?, prompt), kind = ?, spec = ?, notify = COALESCE(?, notify), enabled = ?, next_run = ? WHERE id = ?',
      (a.title as string) ?? null, (a.prompt as string) ?? null, kind, JSON.stringify(spec), (a.notify as string) ?? null, enabled ? 1 : 0, next, cur.id,
    );
    emit({ type: 'schedule.changed', conversationId: ctx.conversationId });
    return enabled ? `Updated. Next run ${new Date(next!).toString()}.` : 'Updated and paused.';
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
