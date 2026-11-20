import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Cat, Hash, MessageCircle, Phone, Plus, Send, Star, Trash2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Field, Input, Page, PageIntro, Segmented, Select, Sheet, Textarea, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { dur, ease } from '../lib/motion';
import { onServerEvent, useStore } from '../lib/store';

type Channel = 'email' | 'phone' | 'discord' | 'telegram' | 'signal' | 'other';
interface Contact {
  channel: Channel;
  value: string;
  label?: string;
}
interface Person {
  id: string;
  name: string;
  kind: 'person' | 'pet';
  relation: string | null;
  aliases: string[];
  contacts: Contact[];
  preferred: Channel | null;
  notes: string | null;
}

const CH: Record<Channel, { icon: typeof AtSign; label: string }> = {
  email: { icon: AtSign, label: 'Email' },
  phone: { icon: Phone, label: 'Phone' },
  discord: { icon: Hash, label: 'Discord' },
  telegram: { icon: Send, label: 'Telegram' },
  signal: { icon: MessageCircle, label: 'Signal' },
  other: { icon: MessageCircle, label: 'Other' },
};

/** A soft, stable color per person, from their name. */
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ p, size = 44 }: { p: Pick<Person, 'name' | 'kind'>; size?: number }) {
  const h = hue(p.name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.38, color: `light-dark(hsl(${h} 45% 40%), hsl(${h} 65% 72%))`, background: `hsl(${h} 60% 50% / 0.15)` }}
    >
      {p.kind === 'pet' ? <Cat style={{ width: size * 0.46, height: size * 0.46 }} /> : p.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Editor({ person, onClose }: { person: Person | 'new' | null; onClose: () => void }) {
  const blank: Person = { id: '', name: '', kind: 'person', relation: '', aliases: [], contacts: [], preferred: null, notes: '' };
  const [p, setP] = useState<Person>(blank);
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (person) setP(person === 'new' ? blank : { ...person, contacts: person.contacts.map((c) => ({ ...c })) });
  }, [person]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<Person>) => setP((x) => ({ ...x, ...patch }));
  async function save() {
    setBusy(true);
    try {
      const body = { ...p, contacts: p.contacts.filter((c) => c.value.trim()) };
      if (person === 'new') await api.post('/people', body);
      else await api.put(`/people/${p.id}`, body);
      onClose();
    } catch (err) {
      toast({ title: 'Could not save', body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={!!person} onClose={onClose} title={person === 'new' ? 'Add someone' : p.name || 'Edit'} description="Private. Cloud models see names and relations, never contact details.">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Name">
            <Input autoFocus value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Jordan" />
          </Field>
          <Field label="Is a">
            <Segmented id="pk" size="sm" value={p.kind} onChange={(kind) => set({ kind })} options={[{ value: 'person', label: 'Person' }, { value: 'pet', label: 'Pet' }]} />
          </Field>
        </div>
        <Field label="Who they are to you">
          <Input value={p.relation ?? ''} onChange={(e) => set({ relation: e.target.value })} placeholder="best friend, sister, boss, our cat…" />
        </Field>
        <Field label="Also called" hint="Separate with commas">
          <Input value={p.aliases.join(', ')} onChange={(e) => set({ aliases: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="Jo, J" />
        </Field>
        {p.kind === 'person' && (
          <Field label="Ways to reach them">
            <div className="space-y-2">
              {p.contacts.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Select value={c.channel} onChange={(e) => set({ contacts: p.contacts.map((x, j) => (j === i ? { ...x, channel: e.target.value as Channel } : x)) })} className="w-32">
                    {Object.entries(CH).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                  <Input value={c.value} onChange={(e) => set({ contacts: p.contacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder={c.channel === 'email' ? 'name@example.com' : c.channel === 'phone' ? '407 555 0100' : 'handle'} />
                  <button
                    onClick={() => set({ preferred: p.preferred === c.channel ? null : c.channel })}
                    title={p.preferred === c.channel ? 'Preferred way' : 'Make this the preferred way'}
                    className={cx('flex size-9 shrink-0 items-center justify-center rounded-md border', p.preferred === c.channel ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-fg-3 hover:text-fg-2')}
                  >
                    <Star className="size-3.5" />
                  </button>
                  <button onClick={() => set({ contacts: p.contacts.filter((_, j) => j !== i) })} className="flex size-9 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger" title="Remove">
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => set({ contacts: [...p.contacts, { channel: 'email', value: '' }] })}>
                <Plus className="size-3.5" /> Add a way
              </Button>
            </div>
          </Field>
        )}
        <Field label="Notes">
          <Textarea value={p.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="Birthday in March, allergic to peanuts…" />
        </Field>
        <div className="flex justify-between pt-2">
          {person !== 'new' ? (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => void api.del(`/people/${p.id}`).then(onClose)}
            >
              <Trash2 className="size-3.5" /> Forget
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!p.name.trim()} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export function PeopleView() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const load = useCallback(() => void api.get<Person[]>('/people').then(setPeople), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'people.changed' && load());
  }, [load]);

  return (
    <>
      <TopBar
        title="People"
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <Plus className="size-3.5" /> Add someone
          </Button>
        }
      />
      <Page width="lg">
        <PageIntro
          title="People"
          description="Who's who in your life, so “text my best friend” just works. Sable learns them as you talk about them. All private: cloud models see names and relations, never addresses or numbers."
        />
        {people && !people.length ? (
          <Empty
            icon={<Users className="size-4" />}
            title="Nobody yet"
            body="Mention someone in a chat (“my sister Maya, her email is…”) and Sable remembers. Or add them here."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="size-3.5" /> Add someone
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {(people ?? []).map((p, i) => (
                <motion.button
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.out, delay: Math.min(i, 10) * 0.03 } }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  onClick={() => setEditing(p)}
                  className="flex items-start gap-3.5 rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong"
                >
                  <Avatar p={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[13px] text-fg-2">{p.relation || (p.kind === 'pet' ? 'Pet' : 'Someone you know')}</span>
                    {p.aliases.length > 0 && <span className="mt-0.5 block truncate text-[12px] text-fg-3">also {p.aliases.join(', ')}</span>}
                    {p.contacts.length > 0 && (
                      <span className="mt-2.5 flex flex-wrap gap-1.5">
                        {p.contacts.map((c, j) => {
                          const Icon = CH[c.channel]?.icon ?? MessageCircle;
                          const pref = p.preferred === c.channel;
                          return (
                            <span key={j} className={cx('inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-1.5 text-[11.5px]', pref ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-fg-3')}>
                              <Icon className="size-3 shrink-0" />
                              <span className="truncate">{CH[c.channel]?.label}</span>
                              {pref && <Star className="size-2.5 shrink-0 fill-current" />}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Page>
      <Editor person={editing} onClose={() => (setEditing(null), load())} />
    </>
  );
}
