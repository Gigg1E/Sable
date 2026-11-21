import { get, run } from '../../db.js';
import { emit } from '../../events.js';
import { createDuty, deleteDuty, dutyTriggers, getDuty, listDuties, runDuty, updateDuty, type Autonomy } from '../../duties.js';
import { fmt } from '../../clock.js';
import { id, now } from '../../util.js';
import { computeNextRun, type ScheduleKind, type ScheduleSpec } from './personal.js';
import { registerTool } from './registry.js';

/** Duties: ongoing responsibilities Sable runs on its own (docs/design/autonomy.md §2). */

const AUTONOMY = ['act', 'suggest', 'watch'];

function attachTimer(dutyId: string, title: string, a: Record<string, unknown>): string | null {
  const kind = a.every_minutes ? 'interval' : a.weekday != null ? 'weekly' : a.time ? 'daily' : a.at ? 'once' : null;
  if (!kind) return null;
  const spec: ScheduleSpec = kind === 'interval' ? { every_minutes: Math.max(10, Number(a.every_minutes)) } : kind === 'once' ? { at: String(a.at) } : { time: String(a.time), ...(kind === 'weekly' ? { weekday: Number(a.weekday) } : {}) };
  const next = computeNextRun(kind as ScheduleKind, spec);
  if (next == null) throw new Error('That time is in the past or unreadable. Use local times like 2026-11-22T09:00, or time "HH:MM".');
  const conv = getDuty(dutyId)?.conversation_id ?? null;
  run(
    "INSERT INTO schedules (id, title, prompt, kind, spec, next_run, enabled, notify, autonomy, conversation_id, duty_id, created_at) VALUES (?, ?, '(runs its duty)', ?, ?, ?, 1, NULL, NULL, ?, ?, ?)",
    id('sch_'), title, kind, JSON.stringify(spec), next, conv, dutyId, now(),
  );
  emit({ type: 'schedule.changed' });
  return fmt(next);
}

registerTool({
  name: 'duty_create',
  label: 'Take on a duty',
  group: 'Duties',
  description:
    "Take on an ongoing responsibility the user wants handled in the background: \"keep an eye on my refund until it lands\", \"make sure I never miss a school deadline\", \"every Friday plan my weekend\". One duty replaces a routine + watcher + notes: it has a purpose, instructions, its own memory, and what wakes it. Wake it by time (time \"HH:MM\" daily, + weekday 0=Sun..6=Sat for weekly, every_minutes ≥ 10, or at = local date-time once), by an existing watcher (watcher_id) or webhook (webhook_id), and/or by mail (mail_from, mail_subject). autonomy: act (does low-risk things itself and reports; sending/buying/deleting still ask; the default), suggest (looks and proposes), watch (only reports). notify: when_new (default; only new things that matter) or always (every run, e.g. a briefing). Ask first if something essential is missing. Use this instead of schedule_create for anything ongoing.",
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short name, e.g. "Refund for order 5521"' },
      purpose: { type: 'string', description: 'The responsibility in one sentence, from the user\'s point of view.' },
      instructions: { type: 'string', description: 'What to do each time it wakes, with every detail needed.' },
      autonomy: { type: 'string', enum: AUTONOMY },
      notify: { type: 'string', enum: ['when_new', 'always'] },
      time: { type: 'string' },
      weekday: { type: 'number' },
      every_minutes: { type: 'number' },
      at: { type: 'string' },
      watcher_id: { type: 'string' },
      webhook_id: { type: 'string' },
      mail_from: { type: 'string' },
      mail_subject: { type: 'string' },
    },
    required: ['title', 'purpose', 'instructions'],
  },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Take on a duty: ${a.title}`,
  async run(a) {
    const autonomy = (AUTONOMY.includes(String(a.autonomy)) ? a.autonomy : 'act') as Autonomy;
    const d = createDuty({
      title: String(a.title),
      purpose: String(a.purpose),
      instructions: String(a.instructions),
      autonomy,
      notify: a.notify === 'always' ? 'always' : 'when_new',
      origin: 'user',
      mail: a.mail_from || a.mail_subject ? { from: a.mail_from ? String(a.mail_from) : undefined, subject: a.mail_subject ? String(a.mail_subject) : undefined } : null,
    });
    const notes: string[] = [];
    const first = attachTimer(d.id, d.title, a);
    if (first) notes.push(`first run ${first}`);
    if (a.watcher_id) {
      const ok = run('UPDATE watchers SET duty_id = ? WHERE id = ?', d.id, String(a.watcher_id)).changes;
      notes.push(ok ? `woken by watcher ${a.watcher_id}` : `no watcher ${a.watcher_id}`);
    }
    if (a.webhook_id) {
      const h = get<{ action: string }>('SELECT action FROM hooks WHERE id = ?', String(a.webhook_id));
      if (h) {
        // The webhook needs instructions for its receipts to wake the duty.
        const action = { ...JSON.parse(h.action), prompt: JSON.parse(h.action).prompt || d.instructions, here: undefined };
        run('UPDATE hooks SET duty_id = ?, action = ? WHERE id = ?', d.id, JSON.stringify(action), String(a.webhook_id));
        notes.push(`woken by webhook ${a.webhook_id}`);
      } else notes.push(`no webhook ${a.webhook_id}`);
    }
    const triggers = dutyTriggers(getDuty(d.id)!);
    if (!triggers.length) notes.push('nothing wakes it yet: add a time, watcher, webhook or mail trigger with duty_update, or run it with duty_run');
    return `Duty ${d.id} "${d.title}" is active (${autonomy}). Wakes on: ${triggers.join(', ') || 'nothing yet'}.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
  },
});

registerTool({
  name: 'duty_list',
  label: 'List duties',
  group: 'Duties',
  description: 'List your duties with what wakes them, their autonomy, status and memory.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: () => 'List duties',
  async run() {
    const list = listDuties();
    if (!list.length) return 'No duties yet.';
    return list
      .map((d) => `- ${d.id} "${d.title}" [${d.status}, ${d.autonomy}, notify ${d.notify}] ${d.purpose}\n  wakes on: ${dutyTriggers(d).join(', ') || 'nothing'}; runs: ${d.runs}${d.last_run ? `, last ${fmt(d.last_run)}` : ''}\n  memory: ${d.memory ? d.memory.slice(0, 300) : '(empty)'}`)
      .join('\n');
  },
});

registerTool({
  name: 'duty_update',
  label: 'Update a duty',
  group: 'Duties',
  description:
    'Change a duty: purpose, instructions, autonomy, notify, status (active, paused, done), its memory, or add a trigger (time/weekday/every_minutes/at, watcher_id, mail_from/mail_subject). Use status "done" when the responsibility is over (the refund landed).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      purpose: { type: 'string' },
      instructions: { type: 'string' },
      autonomy: { type: 'string', enum: AUTONOMY },
      notify: { type: 'string', enum: ['when_new', 'always'] },
      status: { type: 'string', enum: ['active', 'paused', 'done'] },
      memory: { type: 'string' },
      time: { type: 'string' },
      weekday: { type: 'number' },
      every_minutes: { type: 'number' },
      at: { type: 'string' },
      watcher_id: { type: 'string' },
      mail_from: { type: 'string' },
      mail_subject: { type: 'string' },
    },
    required: ['id'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Update duty ${a.id}${a.status ? `: ${a.status}` : ''}`,
  async run(a) {
    const d = getDuty(String(a.id));
    if (!d) return `No duty ${a.id}. duty_list shows them.`;
    // Widening what a duty may do on its own needs the user (the approval screen for duty_create covers new ones).
    if (a.autonomy === 'act' && d.autonomy !== 'act') return 'Only the user can let a duty act on its own: ask them, or they can change it on the Duties page.';
    updateDuty(d.id, {
      title: a.title ? String(a.title) : undefined,
      purpose: a.purpose ? String(a.purpose) : undefined,
      instructions: a.instructions ? String(a.instructions) : undefined,
      autonomy: AUTONOMY.includes(String(a.autonomy)) ? (a.autonomy as Autonomy) : undefined,
      notify: a.notify === 'always' || a.notify === 'when_new' ? a.notify : undefined,
      status: a.status === 'active' || a.status === 'paused' || a.status === 'done' ? a.status : undefined,
      memory: typeof a.memory === 'string' ? a.memory : undefined,
      mail: a.mail_from || a.mail_subject ? { from: a.mail_from ? String(a.mail_from) : undefined, subject: a.mail_subject ? String(a.mail_subject) : undefined } : undefined,
    });
    const first = attachTimer(d.id, d.title, a);
    if (a.watcher_id) run('UPDATE watchers SET duty_id = ? WHERE id = ?', d.id, String(a.watcher_id));
    return `Updated ${d.id}. Wakes on: ${dutyTriggers(getDuty(d.id)!).join(', ') || 'nothing'}${first ? `; next ${first}` : ''}.`;
  },
});

registerTool({
  name: 'duty_run',
  label: 'Run a duty now',
  group: 'Duties',
  description: 'Wake a duty right now (it runs in its own chat, in the background).',
  parameters: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Run duty ${a.id}`,
  async run(a) {
    const d = getDuty(String(a.id));
    if (!d) return `No duty ${a.id}.`;
    const rid = runDuty(d.id, { source: 'manual', kind: 'manual', title: a.reason ? String(a.reason) : 'Asked to run now' });
    return rid ? `Started "${d.title}".` : `"${d.title}" is ${d.status === 'active' ? 'already running; it will run again when free' : d.status}.`;
  },
});

registerTool({
  name: 'duty_delete',
  label: 'Drop a duty',
  group: 'Duties',
  description: 'Delete a duty and its timers (watchers and webhooks stay, unlinked). Prefer duty_update status "done" when it simply finished.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Delete duty ${a.id}`,
  async run(a) {
    return deleteDuty(String(a.id)) ? 'Deleted.' : `No duty ${a.id}.`;
  },
});
