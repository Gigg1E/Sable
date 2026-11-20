import { AnimatePresence, motion } from 'motion/react';
import { Check, Circle, GitBranch, Lightbulb, NotebookPen, Plus, Sparkle, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { dur, ease } from '../lib/motion';
import { navigate } from '../lib/router';
import { onServerEvent } from '../lib/store';

interface Entry {
  id: string;
  ts: number;
  day: string;
  kind: 'note' | 'decision' | 'open_loop' | 'digest' | 'event';
  text: string;
  status: 'open' | 'done';
  conversation_id: string | null;
}

const KIND = {
  decision: { icon: GitBranch, label: 'Decided', color: 'var(--accent)' },
  note: { icon: NotebookPen, label: 'Note', color: 'var(--fg-2)' },
  digest: { icon: Sparkle, label: 'From a chat', color: 'var(--tint)' },
  event: { icon: Lightbulb, label: 'Happened', color: 'var(--ok)' },
  open_loop: { icon: Circle, label: 'Open loop', color: 'var(--accent)' },
} as const;

function dayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((new Date().setHours(0, 0, 0, 0) - date.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** The main chat's journal: open loops first (tick them off), then the last two weeks by day. */
export function JournalTab() {
  const [data, setData] = useState<{ open: Entry[]; recent: Entry[] } | null>(null);
  const [draft, setDraft] = useState('');
  const load = useCallback(() => void api.get<{ open: Entry[]; recent: Entry[] }>('/journal').then(setData), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'journal.changed' && load());
  }, [load]);
  const close = (e: Entry) => {
    setData((d) => d && { ...d, open: d.open.filter((x) => x.id !== e.id) });
    void api.patch(`/journal/${e.id}`, { done: true });
  };
  const add = async () => {
    if (!draft.trim()) return;
    await api.post('/journal', { kind: 'open_loop', text: draft.trim() });
    setDraft('');
  };
  const byDay = new Map<string, Entry[]>();
  for (const e of data?.recent.filter((x) => x.kind !== 'open_loop' || x.status === 'done') ?? []) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="mb-1.5 px-1 text-[11px] font-medium text-fg-3">Open loops</div>
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-panel-2/40 px-2.5">
        <Plus className="size-3.5 shrink-0 text-fg-3" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Something to follow through on…" className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
      </div>
      <AnimatePresence initial={false}>
        {(data?.open ?? []).map((e) => (
          <motion.div key={e.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 16, transition: { duration: dur.quick, ease: ease.in } }} className="group flex items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-panel-2">
            <button onClick={() => close(e)} title="Done" className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-accent/60 text-transparent transition-colors hover:bg-accent hover:text-bg">
              <Check className="size-3" strokeWidth={3} />
            </button>
            <span className="min-w-0 flex-1 text-[13px] leading-snug">{e.text}</span>
            <button onClick={() => void api.del(`/journal/${e.id}`)} title="Remove" className="opacity-0 transition-opacity group-hover:opacity-100">
              <X className="size-3.5 text-fg-3 hover:text-danger" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      {data && !data.open.length && <p className="px-1.5 py-1 text-[12.5px] text-fg-3">Nothing open. Promises you or Sable make land here until they're done.</p>}

      {[...byDay].map(([day, entries]) => (
        <section key={day} className="mt-5">
          <div className="mb-1.5 px-1 text-[11px] font-medium text-fg-3">{dayLabel(day)}</div>
          {entries.map((e) => {
            const k = e.kind === 'open_loop' ? { icon: Check, label: 'Done', color: 'var(--ok)' } : KIND[e.kind];
            const Icon = k.icon;
            return (
              <button
                key={e.id}
                onClick={() => e.conversation_id && e.kind === 'digest' && navigate(`/chat/${e.conversation_id}`)}
                className={cx('flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left', e.kind === 'digest' && e.conversation_id ? 'hover:bg-panel-2' : 'cursor-default')}
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" style={{ color: k.color }} title={k.label}>
                  <Icon className="size-3.5" />
                </span>
                <span className={cx('min-w-0 flex-1 text-[13px] leading-snug', e.kind === 'open_loop' ? 'text-fg-3 line-through' : 'text-fg-2')}>{e.text}</span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
