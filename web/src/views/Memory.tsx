import { AnimatePresence, motion } from 'motion/react';
import { Brain, Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, IconButton, Input, Page, PageIntro, Segmented, TopBar, listItem } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { onServerEvent } from '../lib/store';
import type { Memory } from '../lib/types';

function MemoryRow({ m }: { m: Memory }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  async function save() {
    await api.patch(`/memories/${m.id}`, { content: text });
    setEditing(false);
  }
  return (
    <motion.div layout {...listItem} className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
      {editing ? (
        <>
          <Input value={text} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? void save() : e.key === 'Escape' && setEditing(false))} />
          <IconButton label="Save" onClick={() => void save()}>
            <Check className="size-3.5" />
          </IconButton>
          <IconButton label="Cancel" onClick={() => (setEditing(false), setText(m.content))}>
            <X className="size-3.5" />
          </IconButton>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-[13.5px]">{m.content}</span>
          <button
            onClick={() => void api.patch(`/memories/${m.id}`, { kind: m.kind === 'other' ? 'me' : 'other' })}
            title="Switch between 'About you' and 'People & things'"
            className={cx('h-5 shrink-0 rounded px-1.5 text-[11px]', m.kind === 'other' ? 'bg-panel-3 text-fg-2' : 'bg-tint-soft text-tint')}
          >
            {m.kind === 'other' ? 'people & things' : 'about you'}
          </button>
          <Badge tone="outline">{m.source === 'you' ? 'you' : 'learned'}</Badge>
          <span className="hidden w-16 text-right font-mono text-[11px] text-fg-3 sm:block">{timeAgo(m.updated_at)}</span>
          <div className="flex transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <IconButton label="Edit" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton label="Forget" className="hover:text-danger" onClick={() => void api.del(`/memories/${m.id}`)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </>
      )}
    </motion.div>
  );
}

export function MemoryView() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(() => void api.get<Memory[]>('/memories').then(setMemories), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'memory.changed' && load());
  }, [load]);

  const [tab, setTab] = useState<'all' | 'me' | 'other'>('all');
  async function add() {
    if (!draft.trim()) return;
    await api.post('/memories', { content: draft.trim(), kind: tab === 'other' ? 'other' : 'me' });
    setDraft('');
  }
  const shown = (memories ?? []).filter((m) => (!q || m.content.toLowerCase().includes(q.toLowerCase())) && (tab === 'all' || (tab === 'other' ? m.kind === 'other' : m.kind !== 'other')));

  return (
    <>
      <TopBar title="Memory" />
      <Page width="md">
        <PageIntro
          title="Memory"
          description="Lasting facts the agent keeps. 'About you' is always in mind; 'People & things' (contacts, places, accounts) only comes up when a conversation is about them. Tasks are never saved here: those are routines and watchers."
        />
        <div className="mb-3">
          <Segmented
            id="memory-tab"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'all', label: `All${memories ? ` ${memories.length}` : ''}` },
              { value: 'me', label: 'About you' },
              { value: 'other', label: 'People & things' },
            ]}
          />
        </div>
        <div className="mb-4 flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Add a fact, e.g. “I'm vegetarian”" />
          <Button variant="primary" onClick={() => void add()} disabled={!draft.trim()}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {memories && memories.length > 6 && (
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
            <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${memories.length} memories`} />
          </div>
        )}
        {memories && !memories.length ? (
          <Empty icon={<Brain className="size-4" />} title="No memories yet" body="The agent saves lasting preferences as you talk. You can add your own too." />
        ) : (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {shown.map((m) => (
                <MemoryRow key={m.id} m={m} />
              ))}
            </AnimatePresence>
          </Card>
        )}
      </Page>
    </>
  );
}
