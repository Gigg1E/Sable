import { deletePerson, describePerson, findPeople, listPeople, savePerson, type Channel, type Contact } from '../../people.js';
import { registerTool } from './registry.js';

const CHANNELS: Channel[] = ['email', 'phone', 'discord', 'telegram', 'signal', 'other'];

registerTool({
  name: 'person_save',
  label: 'Remember a person',
  group: 'People',
  description:
    "Remember someone (or a pet) in the user's life: name, who they are to the user (relation: \"best friend\", \"sister\", \"boss\", \"cat\"), other names they go by, and how to reach them. Call it whenever the user mentions someone new with a relation or contact detail, or tells you how someone prefers to be reached. Saving the same name again adds to what's known; nothing is lost. Private: cloud models only see names and relations.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: ['person', 'pet'] },
      relation: { type: 'string', description: 'Who they are to the user, in the user\'s words' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Nicknames, other names' },
      contacts: { type: 'array', items: { type: 'object', properties: { channel: { type: 'string', enum: CHANNELS }, value: { type: 'string' }, label: { type: 'string' } }, required: ['channel', 'value'] } },
      preferred: { type: 'string', enum: CHANNELS, description: 'How they like to be reached, once the user says' },
      notes: { type: 'string', description: 'Short, useful facts (birthday, likes)' },
    },
    required: ['name'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Remember ${a.name}${a.relation ? ` (${a.relation})` : ''}`,
  async run(a) {
    const p = savePerson({
      name: String(a.name),
      kind: a.kind === 'pet' ? 'pet' : 'person',
      relation: a.relation ? String(a.relation) : undefined,
      aliases: Array.isArray(a.aliases) ? a.aliases.map(String) : undefined,
      contacts: Array.isArray(a.contacts) ? (a.contacts as Contact[]).filter((c) => CHANNELS.includes(c.channel) && c.value).map((c) => ({ channel: c.channel, value: String(c.value).trim(), label: c.label })) : undefined,
      preferred: CHANNELS.includes(a.preferred) ? a.preferred : undefined,
      notes: a.notes ? String(a.notes) : undefined,
    });
    return `Saved: ${describePerson(p)}`;
  },
});

registerTool({
  name: 'person_find',
  label: 'Look someone up',
  group: 'People',
  description: 'Find a person by name, nickname or relation ("my best friend", "sis", "the cat"). Returns who they are and which ways to reach them are on file. To message them, pass their name as the recipient (e.g. email_send to "Jordan"); the address is filled in for you.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Look up ${a.query}`,
  async run(a) {
    const found = findPeople(String(a.query));
    if (!found.length) return `Nobody matching "${a.query}" yet. Ask the user who they mean, then save them with person_save.`;
    return found.map((p) => describePerson(p)).join('\n');
  },
});

registerTool({
  name: 'person_list',
  label: 'List people',
  group: 'People',
  description: 'Everyone Sable knows about, with relations.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const all = listPeople();
    return all.length ? all.map((p) => describePerson(p)).join('\n') : 'No people saved yet.';
  },
});

registerTool({
  name: 'person_forget',
  label: 'Forget a person',
  group: 'People',
  description: 'Forget someone entirely (by id from person_find). Only when the user asks.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: () => 'Forget a person',
  async run(a) {
    return deletePerson(String(a.id)) ? 'Forgotten.' : 'No person with that id.';
  },
});
