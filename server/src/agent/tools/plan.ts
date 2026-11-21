import { parseLocal, fmt, fmtTime } from '../../clock.js';
import { addPlanItem, deletePlanItem, getPlanItem, planBetween, updatePlanItem } from '../../plan.js';
import { registerTool } from './registry.js';

/** Sable's plan: what it will do when, and time it blocks out for the user (docs/design/plan.md). */

function when(v: unknown, what: string): number {
  const t = parseLocal(String(v ?? ''));
  if (!Number.isFinite(t)) throw new Error(`${what} must be a local date-time like 2026-11-22T20:00.`);
  return t;
}

registerTool({
  name: 'plan_add',
  label: 'Add to the plan',
  group: 'Plan',
  description:
    'Put something on the plan at a time. who "sable": something YOU will do then, on your own (check a status, prepare a draft, follow up); write notes with every detail you\'ll need. who "you": time blocked for the USER to do something (an assignment, an errand, a workout); they get a nudge at the start. start/end are local date-times without offset. The user sees the whole plan on the Plan page. Not for repeating things (use a duty) or a plain one-off ping (reminder_set).',
  parameters: {
    type: 'object',
    properties: {
      who: { type: 'string', enum: ['sable', 'you'] },
      title: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['who', 'title', 'start'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Plan: ${a.title}`,
  async run(a, ctx) {
    const start = when(a.start, 'start');
    if (start < Date.now() - 60_000) return `${fmt(start)} is in the past. Pick a future time.`;
    const end = a.end ? when(a.end, 'end') : null;
    if (end != null && end <= start) return 'end must be after start.';
    const p = addPlanItem({ who: a.who === 'you' ? 'you' : 'sable', title: String(a.title), notes: a.notes ? String(a.notes) : undefined, start, end, conversationId: ctx.conversationId });
    return `Planned ${p.id}: ${p.who === 'you' ? 'for the user' : 'for you'} ${fmt(p.start_at)}${p.end_at ? `–${fmtTime(p.end_at)}` : ''} "${p.title}".`;
  },
});

registerTool({
  name: 'plan_list',
  label: 'Read the plan',
  group: 'Plan',
  description: 'List plan items between two local date-times (default: today and the next 7 days).',
  parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: () => 'Read the plan',
  async run(a) {
    const from = a.from ? when(a.from, 'from') : Date.now() - 12 * 3600_000;
    const to = a.to ? when(a.to, 'to') : Date.now() + 7 * 86_400_000;
    const items = planBetween(from, to);
    if (!items.length) return 'Nothing planned in that range.';
    return items.map((p) => `- ${p.id} ${fmt(p.start_at)}${p.end_at ? `–${fmtTime(p.end_at)}` : ''} [${p.who}, ${p.status}] ${p.title}${p.notes ? ` — ${p.notes.slice(0, 160)}` : ''}`).join('\n');
  },
});

registerTool({
  name: 'plan_update',
  label: 'Change the plan',
  group: 'Plan',
  description: 'Move, rename or annotate a plan item, mark it done or skipped, or delete it (delete: true).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      notes: { type: 'string' },
      status: { type: 'string', enum: ['planned', 'done', 'skipped'] },
      delete: { type: 'boolean' },
    },
    required: ['id'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => (a.delete ? `Remove ${a.id} from the plan` : `Update plan ${a.id}${a.status ? `: ${a.status}` : ''}`),
  async run(a) {
    const p = getPlanItem(String(a.id));
    if (!p) return `No plan item ${a.id}.`;
    if (a.delete) return deletePlanItem(p.id) ? 'Removed.' : 'Already gone.';
    const n = updatePlanItem(p.id, {
      title: a.title ? String(a.title) : undefined,
      notes: typeof a.notes === 'string' ? a.notes : undefined,
      start_at: a.start ? when(a.start, 'start') : undefined,
      end_at: a.end ? when(a.end, 'end') : undefined,
      status: a.status === 'planned' || a.status === 'done' || a.status === 'skipped' ? a.status : undefined,
    })!;
    return `Updated: ${fmt(n.start_at)} "${n.title}" (${n.status}).`;
  },
});
