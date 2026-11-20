import { all, get, run } from './db.js';
import { emit } from './events.js';
import { mainModelIsLocal } from './library.js';
import { id, now, parseJson } from './util.js';

/**
 * People (and pets) in the user's life. Private by nature. Sable learns who they are to the user
 * ("best friend", "sister", "the cat") and how to reach them, so "message my best friend" works
 * without asking for an address. Cloud models see names and relations, never contact details:
 * messaging tools take a person's name and the server fills in the address.
 */

export type Channel = 'email' | 'phone' | 'discord' | 'telegram' | 'signal' | 'other';
export interface Contact {
  channel: Channel;
  value: string;
  label?: string;
}
export interface Person {
  id: string;
  name: string;
  kind: 'person' | 'pet';
  relation: string | null;
  aliases: string[];
  contacts: Contact[];
  preferred: Channel | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

const rowToPerson = (r: Record<string, unknown>): Person => ({
  ...(r as unknown as Person),
  aliases: parseJson<string[]>(r.aliases as string, []),
  contacts: parseJson<Contact[]>(r.contacts as string, []),
});

export function listPeople(): Person[] {
  return all<Record<string, unknown>>('SELECT * FROM people ORDER BY updated_at DESC').map(rowToPerson);
}

export function getPerson(pid: string): Person | undefined {
  const r = get<Record<string, unknown>>('SELECT * FROM people WHERE id = ?', pid);
  return r ? rowToPerson(r) : undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/^(my|our|the)\s+/, '').replace(/[^\p{L}\p{N} ]/gu, '').trim();

/** Find by name, alias or relation: "Jordan", "my best friend", "sis", "the cat". */
export function findPeople(query: string): Person[] {
  const q = norm(query);
  if (!q) return [];
  const people = listPeople();
  const exact = people.filter((p) => [p.name, ...p.aliases, p.relation ?? ''].some((x) => x && norm(x) === q));
  if (exact.length) return exact;
  return people.filter((p) => [p.name, ...p.aliases, p.relation ?? ''].some((x) => x && (norm(x).includes(q) || (q.length > 3 && q.includes(norm(x))))));
}

export function savePerson(input: { id?: string; name: string; kind?: 'person' | 'pet'; relation?: string; aliases?: string[]; contacts?: Contact[]; preferred?: Channel; notes?: string }): Person {
  const existing = input.id ? getPerson(input.id) : findPeople(input.name).find((p) => norm(p.name) === norm(input.name));
  if (existing) {
    // Merge: new aliases and contacts are added, not replaced, so learning never loses what was known.
    const aliases = [...new Set([...existing.aliases, ...(input.aliases ?? [])].filter(Boolean))];
    const contacts = [...existing.contacts];
    for (const c of input.contacts ?? []) {
      const same = contacts.findIndex((x) => x.channel === c.channel && (x.value.toLowerCase() === c.value.toLowerCase() || (c.label && x.label === c.label)));
      if (same >= 0) contacts[same] = { ...contacts[same], ...c };
      else contacts.push(c);
    }
    run(
      'UPDATE people SET name = ?, kind = ?, relation = ?, aliases = ?, contacts = ?, preferred = ?, notes = ?, updated_at = ? WHERE id = ?',
      input.name || existing.name, input.kind ?? existing.kind, input.relation ?? existing.relation, JSON.stringify(aliases), JSON.stringify(contacts),
      input.preferred ?? existing.preferred, input.notes ?? existing.notes, now(), existing.id,
    );
    emit({ type: 'people.changed' });
    return getPerson(existing.id)!;
  }
  const pid = id('per_');
  run(
    'INSERT INTO people (id, name, kind, relation, aliases, contacts, preferred, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    pid, input.name, input.kind ?? 'person', input.relation ?? null, JSON.stringify(input.aliases ?? []), JSON.stringify(input.contacts ?? []), input.preferred ?? null, input.notes ?? null, now(), now(),
  );
  emit({ type: 'people.changed' });
  return getPerson(pid)!;
}

export function deletePerson(pid: string) {
  const ok = run('DELETE FROM people WHERE id = ?', pid).changes > 0;
  if (ok) emit({ type: 'people.changed' });
  return ok;
}

/** "j•••@example.com", "•••-0199": enough to tell contacts apart without revealing them. */
function mask(c: Contact) {
  if (c.channel === 'email') {
    const [u, d] = c.value.split('@');
    return `${u.slice(0, 1)}•••@${d ?? ''}`;
  }
  if (c.channel === 'phone') return `•••-${c.value.replace(/\D/g, '').slice(-4)}`;
  return `${c.value.slice(0, 2)}•••`;
}

/** How a person is described to the model: full details only for a local model. */
export function describePerson(p: Person, full = mainModelIsLocal()): string {
  const ways = p.contacts.map((c) => `${c.channel}${c.label ? ` (${c.label})` : ''}: ${full ? c.value : mask(c)}`).join(', ');
  return `${p.name}${p.kind === 'pet' ? ' (pet)' : ''}${p.relation ? `, ${p.relation}` : ''}${p.aliases.length ? ` (also: ${p.aliases.join(', ')})` : ''}${ways ? ` · reach via ${ways}` : ''}${p.preferred ? ` · prefers ${p.preferred}` : ''}${p.notes ? ` · ${p.notes}` : ''} [${p.id}]`;
}

/** Short list for the system prompt: who's who, without contact details. */
export function peopleLine(max = 30) {
  const ps = listPeople().slice(0, max);
  if (!ps.length) return '';
  return ps
    .map((p) => `${p.name}${p.kind === 'pet' ? ' (pet)' : ''}${p.relation ? ` = ${p.relation}` : ''}${p.contacts.length ? ` [${[...new Set(p.contacts.map((c) => c.channel))].join('/')}]` : ''}${p.preferred ? ` prefers ${p.preferred}` : ''}`)
    .join('; ');
}

/**
 * A recipient written as a name ("Jordan", "my sister", "@Jordan") becomes that person's address on the
 * given channel. Real addresses pass through unchanged. Throws a clear message when it can't decide.
 */
export function resolveRecipient(to: string, channel: Channel): string {
  const t = to.trim().replace(/^@/, '');
  if (channel === 'email' && /@[^\s@]+\.[^\s@]+$/.test(t)) return t;
  if (channel === 'phone' && /^\+?[\d\s().-]{7,}$/.test(t)) return t;
  const matches = findPeople(t);
  if (!matches.length) throw new Error(`I don't know who "${to}" is yet. Ask the user for their ${channel} and save it with person_save.`);
  if (matches.length > 1) throw new Error(`"${to}" matches ${matches.map((p) => p.name).join(' and ')}. Ask the user which one.`);
  const p = matches[0];
  const options = p.contacts.filter((c) => c.channel === channel);
  if (!options.length) throw new Error(`${p.name} has no ${channel} saved${p.contacts.length ? ` (known: ${[...new Set(p.contacts.map((c) => c.channel))].join(', ')})` : ''}. Ask the user for it and save it with person_save.`);
  return options[0].value;
}
