import { createReminder, deleteReminder, listReminders, parseDue, updateReminder, whenText } from '../../reminders.js';
import { registerTool } from './registry.js';

/** One-off reminders: a time and a message, gone once they fire. */

const card = (r: { id: string; text: string; note: string | null; due_at: number; wake?: number }) => ({ type: 'reminder', id: r.id, text: r.text, note: r.wake ? undefined : (r.note ?? undefined), due: r.due_at, wake: !!r.wake });

registerTool({
  name: 'reminder_set',
  label: 'Set reminder',
  group: 'Schedules',
  description:
    'Remind the user of something once: "remind me about class at 10 tonight", "in 20 minutes remind me to check the oven". At that time they get a notification with the text, then the reminder disappears. No approval needed. Use this for every one-off reminder; use schedule_create only for things that repeat, or for a one-time job YOU must do at a time (e.g. "email Sam at 8pm"). Give at (the user's local date-time, no offset, e.g. 2026-11-20T22:00) or in_minutes. For "remind me before X", pick the time before X (e.g. 15 minutes before) and say so.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Short, what to be reminded of, e.g. "Class at 10:30"' },
      at: { type: 'string', description: 'ISO date-time, e.g. 2026-11-20T22:00' },
      in_minutes: { type: 'number', description: 'Instead of at: minutes from now' },
      note: { type: 'string', description: 'Optional extra detail shown under the text (room, link, what to bring)' },
    },
    required: ['text'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Remind “${a.text}”`,
  async run(a, ctx) {
    const due = parseDue(a.at, a.in_minutes);
    if (typeof due === 'string') return `Not set: ${due}`;
    const r = createReminder({ text: String(a.text ?? 'Reminder'), note: a.note ? String(a.note) : undefined, due, conversationId: ctx.conversationId });
    return { content: `Reminder ${r.id} set for ${whenText(r.due_at)} (${new Date(r.due_at).toString()}). It notifies the user once, then disappears. The user can cancel it from the card or Routines → Reminders.`, cards: [card(r)] };
  },
});

registerTool({
  name: 'reminder_list',
  label: 'List reminders',
  group: 'Schedules',
  description: 'List upcoming one-off reminders.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const list = listReminders();
    return list.length ? list.map((r) => `${r.id} — ${r.text} · ${whenText(r.due_at)}${r.note ? ` · ${r.note}` : ''}`).join('\n') : 'No upcoming reminders.';
  },
});

registerTool({
  name: 'reminder_update',
  label: 'Change reminder',
  group: 'Schedules',
  description: 'Move or reword an upcoming reminder (find its id with reminder_list). Give at or in_minutes to move it.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, note: { type: 'string' }, at: { type: 'string' }, in_minutes: { type: 'number' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Change reminder ${a.id}`,
  async run(a) {
    let due: number | undefined;
    if (a.at || a.in_minutes != null) {
      const d = parseDue(a.at, a.in_minutes);
      if (typeof d === 'string') return `Not changed: ${d}`;
      due = d;
    }
    const r = updateReminder(String(a.id), { text: a.text, note: a.note, due });
    if (!r) return 'No upcoming reminder with that id (it may have already gone off). Use reminder_list.';
    return { content: `Updated: ${r.text} · ${whenText(r.due_at)}.`, cards: [card(r)] };
  },
});

registerTool({
  name: 'reminder_cancel',
  label: 'Cancel reminder',
  group: 'Schedules',
  description: 'Cancel an upcoming reminder by id.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Cancel reminder ${a.id}`,
  async run(a) {
    return deleteReminder(String(a.id)) ? 'Cancelled.' : 'No upcoming reminder with that id.';
  },
});

registerTool({
  name: 'follow_up',
  label: 'Follow up later',
  group: 'Schedules',
  description:
    "\"I'll remind you\" instead of \"I'll set a reminder\": schedule a moment when THIS chat wakes up again, with a note to yourself, and you decide then what to tell the user (and can check things first). Use it when the reminder needs this conversation's context or is something you own: \"check whether the essay got submitted, he was worried about citations\", \"see if the refund came through\". For a plain ping (\"remind me at 10 about class\") use reminder_set. Give at (ISO) or in_minutes.",
  parameters: {
    type: 'object',
    properties: {
      about: { type: 'string', description: 'Short label the user sees, e.g. "Essay citations"' },
      note: { type: 'string', description: 'Your note to yourself for when you wake: what to check, what matters' },
      at: { type: 'string' },
      in_minutes: { type: 'number' },
    },
    required: ['about', 'note'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Follow up: ${a.about}`,
  async run(a, ctx) {
    const due = parseDue(a.at, a.in_minutes);
    if (typeof due === 'string') return `Not set: ${due}`;
    const r = createReminder({ text: String(a.about), note: String(a.note), due, conversationId: ctx.conversationId, wake: true });
    return { content: `Follow-up ${r.id} set for ${whenText(r.due_at)}. This chat wakes then with your note. The user sees a chip and can cancel or move it.`, cards: [card(r)] };
  },
});
