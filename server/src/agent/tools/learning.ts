import { get } from '../../db.js';
import { getDuty } from '../../duties.js';
import { addSuggestion } from '../../initiative.js';
import { notify } from '../../push.js';
import { registerTool } from './registry.js';

/** The self-review's proposals: lessons and duty edits, each accepted or rejected by the user. */

registerTool({
  name: 'lesson_propose',
  label: 'Propose a lesson',
  group: 'Learning',
  description:
    'Propose a lesson learned from the user (it applies once they accept): a short, concrete rule like "Only tell the user about price drops of 10% or more". scope: "all", "initiative", "plan" or "duty:<id>". why: the evidence (what they did or said). To drop an existing lesson that is wrong or outdated, pass retire_id (and optionally a replacement text).',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' }, scope: { type: 'string' }, why: { type: 'string' }, retire_id: { type: 'string' } },
    required: ['why'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => (a.text ? `Propose lesson: ${String(a.text).slice(0, 60)}` : `Propose retiring ${a.retire_id}`),
  async run(a) {
    if (!a.text && !a.retire_id) return 'Give the lesson text, or retire_id.';
    const old = a.retire_id ? get<{ text: string }>('SELECT text FROM lessons WHERE id = ?', String(a.retire_id)) : undefined;
    if (a.retire_id && !old) return `No lesson ${a.retire_id}.`;
    const title = a.text ? `Learn: ${String(a.text)}` : `Forget: ${old!.text}`;
    const r = addSuggestion({
      title,
      why: String(a.why),
      action: a.text ? `${old ? `Replace “${old.text}” with: ` : ''}${String(a.text)}` : `Stop following “${old!.text}”.`,
      kind: 'lesson',
      payload: { text: a.text ? String(a.text) : undefined, scope: a.scope ? String(a.scope) : 'all', retire_id: a.retire_id ? String(a.retire_id) : undefined, before: old?.text },
    });
    if (!r.ok) return `Not added: ${r.reason}`;
    await notify({ title: `Sable learned something: ${String(a.text ?? old!.text).slice(0, 80)}`, body: 'Accept or reject it in your Inbox.', link: '/inbox', kind: 'suggestion', verdict: 'digest', source: 'learning', key: `lesson:${r.id}` });
    return 'Proposed. The user decides in their Inbox.';
  },
});

registerTool({
  name: 'duty_propose_edit',
  label: 'Propose a duty change',
  group: 'Learning',
  description: "Propose a better version of a duty (applies once the user accepts). field: instructions, purpose, title or notify (when_new / always). after: the full new value. why: what in its record shows the change is needed.",
  parameters: {
    type: 'object',
    properties: { duty_id: { type: 'string' }, field: { type: 'string', enum: ['instructions', 'purpose', 'title', 'notify'] }, after: { type: 'string' }, why: { type: 'string' } },
    required: ['duty_id', 'field', 'after', 'why'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Propose changing ${a.field} of ${a.duty_id}`,
  async run(a) {
    const d = getDuty(String(a.duty_id));
    if (!d) return `No duty ${a.duty_id}.`;
    const field = String(a.field) as 'instructions' | 'purpose' | 'title' | 'notify';
    const before = String(d[field] ?? '');
    if (before.trim() === String(a.after).trim()) return 'That is what it already says.';
    const r = addSuggestion({
      title: `Improve “${d.title}”: ${field}`,
      why: String(a.why),
      action: String(a.after),
      kind: 'duty_edit',
      payload: { duty_id: d.id, field, before, after: String(a.after) },
    });
    if (!r.ok) return `Not added: ${r.reason}`;
    await notify({ title: `Sable suggests improving “${d.title}”`, body: String(a.why).slice(0, 160), link: '/inbox', kind: 'suggestion', verdict: 'digest', source: 'learning', key: `dutyedit:${r.id}` });
    return 'Proposed. The user decides in their Inbox.';
  },
});
