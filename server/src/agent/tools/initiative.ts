import { addSuggestion } from '../../initiative.js';
import { notify } from '../../push.js';
import { registerTool } from './registry.js';

/** What Sable does and proposes on its own (docs/design/autonomy.md §4). */

registerTool({
  name: 'suggest',
  label: 'Suggest',
  group: 'Initiative',
  description:
    "Propose something to the user that you noticed on your own: it shows in their Inbox with Do it / Not now / Never. title: short and specific. why: what you noticed (one or two sentences). action: exactly what you'll do if they tap Do it, with every detail. kind: task (a one-off) or duty (an ongoing responsibility to set up). Use for anything that sends, buys or deletes, or that you're not sure they want.",
  parameters: {
    type: 'object',
    properties: { title: { type: 'string' }, why: { type: 'string' }, action: { type: 'string' }, kind: { type: 'string', enum: ['task', 'duty'] } },
    required: ['title', 'why', 'action'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Suggest: ${a.title}`,
  async run(a) {
    const r = addSuggestion({ title: String(a.title), why: String(a.why), action: String(a.action), kind: a.kind === 'duty' ? 'duty' : 'task' });
    if (!r.ok) return `Not added: ${r.reason}`;
    await notify({ title: `Idea: ${String(a.title)}`, body: String(a.why), link: '/inbox', kind: 'suggestion', verdict: 'digest', source: 'initiative:suggest', key: `suggest:${r.id}` });
    return 'Suggested. It is in the user\'s Inbox.';
  },
});

registerTool({
  name: 'done_for_you',
  label: 'Done for you',
  group: 'Initiative',
  description: "Record something you did on your own initiative, so the user can see it under Done for you (no ping). title: what you did, past tense (\"Set a reminder for 7:15 before your 8am lab\"). detail: anything worth knowing, like how to undo it.",
  parameters: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Done: ${a.title}`,
  async run(a, ctx) {
    await notify({ title: String(a.title), body: a.detail ? String(a.detail) : '', link: `/chat/${ctx.conversationId}`, kind: 'done', verdict: 'log', source: 'initiative:done' });
    return 'Recorded.';
  },
});
