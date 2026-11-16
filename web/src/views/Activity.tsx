import { AnimatePresence, motion } from 'motion/react';
import { Activity as ActivityIcon, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toolIcon } from '../components/ToolCall';
import { Badge, Button, Empty, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent } from '../lib/store';
import type { ActivityItem } from '../lib/types';

const TONE: Record<string, 'ok' | 'warn' | 'danger' | 'default' | 'accent'> = { ok: 'ok', approved: 'accent', denied: 'danger', blocked: 'danger', error: 'danger' };

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function Row({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(item.tool);
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/50">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{item.summary}</div>
          <div className="text-xs text-subtle">
            {item.agent} · {new Date(item.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            {item.duration_ms != null && ` · ${item.duration_ms < 1000 ? `${item.duration_ms}ms` : `${(item.duration_ms / 1000).toFixed(1)}s`}`}
          </div>
        </div>
        <Badge tone={TONE[item.status] ?? 'default'}>{item.status}</Badge>
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="text-subtle">
          <ChevronRight className="size-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-4 pb-4 text-xs">
              <pre className="max-h-48 overflow-auto rounded-xl border border-line bg-surface-2 p-2.5 font-mono text-muted whitespace-pre-wrap">{item.input}</pre>
              {item.output && <pre className="max-h-64 overflow-auto rounded-xl border border-line bg-surface-2 p-2.5 font-mono text-muted whitespace-pre-wrap">{item.output}</pre>}
              {item.conversation_id && (
                <Button size="sm" variant="ghost" onClick={() => navigate(`/chat/${item.conversation_id}`)}>
                  Open chat
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ActivityView() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(true);
  const load = useCallback(() => void api.get<ActivityItem[]>('/activity?limit=100').then((r) => (setItems(r), setMore(r.length === 100))), []);
  useEffect(() => {
    load();
    let t: ReturnType<typeof setTimeout>;
    return onServerEvent((ev) => {
      if (ev.type === 'activity') {
        clearTimeout(t);
        t = setTimeout(load, 300);
      }
    });
  }, [load]);

  async function loadMore() {
    if (!items?.length) return;
    const next = await api.get<ActivityItem[]>(`/activity?limit=100&before=${items[items.length - 1].ts}`);
    setItems([...items, ...next]);
    setMore(next.length === 100);
  }

  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const it of items ?? []) {
    const label = dayLabel(it.ts);
    const g = groups[groups.length - 1];
    if (g?.label === label) g.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
        <PageHeader title="Activity" subtitle="A complete log of every action your agents took, approved, or were stopped from taking." />
        {items && !items.length ? (
          <Empty icon={<ActivityIcon className="size-6" />} title="No activity yet" body="Everything Sable and its sub-agents do will be recorded here." />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <motion.section key={g.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <h2 className="mb-2 text-[13px] font-medium text-subtle">{g.label}</h2>
                <div className={cx('overflow-hidden rounded-2xl border border-line bg-surface shadow-soft')}>
                  {g.items.map((it) => (
                    <Row key={it.id} item={it} />
                  ))}
                </div>
              </motion.section>
            ))}
            {more && items && items.length > 0 && (
              <div className="flex justify-center">
                <Button variant="ghost" onClick={() => void loadMore()}>
                  Load older
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
