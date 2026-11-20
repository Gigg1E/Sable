import { journalAdd, journalClose, journalRecent, openLoops } from '../../brain.js';
import { registerTool } from './registry.js';

/** The main brain's journal: what happened, what was decided, and open loops. Private. */

registerTool({
  name: 'journal_add',
  label: 'Add to the journal',
  group: 'Journal',
  description:
    "Add to your journal (private, kept by the main chat). kind: decision (something settled), note (worth remembering about the user's days), open_loop (something you or the user committed to doing later; close it when done), event (something that happened). One short line each.",
  parameters: {
    type: 'object',
    properties: { kind: { type: 'string', enum: ['decision', 'note', 'open_loop', 'event'] }, text: { type: 'string' } },
    required: ['kind', 'text'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => (a.kind === 'open_loop' ? `Open loop: ${String(a.text).slice(0, 60)}` : `Journal: ${String(a.text).slice(0, 60)}`),
  async run(a, ctx) {
    const e = journalAdd(a.kind, String(a.text), ctx.conversationId);
    return `Added ${e.kind} ${e.id}.`;
  },
});

registerTool({
  name: 'journal_close',
  label: 'Close an open loop',
  group: 'Journal',
  description: 'Mark an open loop as done (id from the open loops list).',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: () => 'Close an open loop',
  async run(a) {
    return journalClose(String(a.id)) ? 'Closed.' : 'No journal entry with that id.';
  },
});

registerTool({
  name: 'journal_list',
  label: 'Read the journal',
  group: 'Journal',
  description: 'Read the journal: open loops and entries from the last N days (default 7).',
  parameters: { type: 'object', properties: { days: { type: 'integer' } } },
  risk: 'low',
  defaultPolicy: 'auto',
  async run(a) {
    const loops = openLoops();
    const recent = journalRecent(Math.min(Number(a.days) || 7, 90));
    return [
      loops.length ? `Open loops:\n${loops.map((l) => `- [${l.id}] ${l.text} (since ${l.day})`).join('\n')}` : 'No open loops.',
      recent.length ? `Entries:\n${recent.map((e) => `- ${e.day} ${e.kind}${e.status === 'done' ? ' (done)' : ''}: ${e.text}`).join('\n')}` : 'No entries.',
    ].join('\n\n');
  },
});
