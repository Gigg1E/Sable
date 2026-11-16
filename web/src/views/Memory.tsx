import { AnimatePresence, motion } from 'motion/react';
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, IconButton, Input, PageHeader, listItem } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
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
    <motion.div layout {...listItem}>
      <Card className="group flex items-center gap-3 px-4 py-3">
        {editing ? (
          <>
            <Input value={text} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
            <IconButton label="Save" onClick={() => void save()}>
              <Check className="size-4" />
            </IconButton>
            <IconButton label="Cancel" onClick={() => (setEditing(false), setText(m.content))}>
              <X className="size-4" />
            </IconButton>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{m.content}</div>
              <div className="mt-0.5 text-xs text-subtle">
                {m.source === 'you' ? 'Added by you' : `Learned by ${m.source ?? 'Sable'}`} · {timeAgo(m.updated_at)}
              </div>
            </div>
            <div className="flex opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <IconButton label="Edit" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label="Forget" className="hover:text-danger" onClick={() => void api.del(`/memories/${m.id}`)}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </>
        )}
      </Card>
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

  async function add() {
    if (!draft.trim()) return;
    await api.post('/memories', { content: draft.trim() });
    setDraft('');
  }
  const shown = (memories ?? []).filter((m) => !q || m.content.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
        <PageHeader title="Memory" subtitle="What Sable knows about you. It's all editable, and nothing here is ever shared." />
        <div className="mb-5 flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Teach Sable something, e.g. “I'm vegetarian”" />
          <Button variant="primary" onClick={() => void add()} disabled={!draft.trim()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {memories && memories.length > 8 && <Input className="mb-4" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter memories" />}
        {memories && !memories.length ? (
          <Empty icon={<Brain className="size-6" />} title="Nothing remembered yet" body="Sable saves lasting preferences and facts as you chat. You can also add them yourself." />
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {shown.map((m) => (
                <MemoryRow key={m.id} m={m} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
