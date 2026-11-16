import { AnimatePresence, motion } from 'motion/react';
import { Activity as ActivityIcon, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toolIcon } from '../components/ToolCall';
import { Badge, Button, Card, Empty, Page, PageIntro, Segmented, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { onServerEvent } from '../lib/store';
import type { ActivityItem } from '../lib/types';

const TONE: Record<string, 'ok' | 'accent' | 'danger' | 'default' | 'info'> = { ok: 'ok', approved: 'info', denied: 'danger', blocked: 'danger', error: 'danger' };

function dayLabel(ts: number) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

function Row({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(item.tool);
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-2/50">
        <span className="w-14 shrink-0 font-mono text-[11px] text-fg-3 tabular">{new Date(item.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        <Icon className="size-3.5 shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-[13px]">{item.summary}</span>
        <span className="hidden w-24 truncate text-[12px] text-fg-3 sm:block">{item.agent}</span>
        <span className="w-[72px] text-right">
          <Badge tone={TONE[item.status] ?? 'default'}>{item.status}</Badge>
        </span>
        <span className="hidden w-12 text-right font-mono text-[11px] text-fg-3 tabular md:block">{item.duration_ms != null ? fmtMs(item.duration_ms) : '—'}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-fg-3">
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="space-y-2 px-4 pb-4 pl-[84px] text-[11.5px]">
              <div className="font-mono text-fg-3">{item.tool}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-2.5 font-mono text-fg-2">{item.input}</pre>
              {item.output && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-2.5 font-mono text-fg-2">{item.output}</pre>}
              {item.conversation_id && (
                <Button size="xs" variant="ghost" onClick={() => navigate(`/chat/${item.conversation_id}`)}>
                  Open chat →
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
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');
  const load = useCallback(() => void api.get<ActivityItem[]>('/activity?limit=150').then((r) => (setItems(r), setMore(r.length === 150))), []);
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
    const next = await api.get<ActivityItem[]>(`/activity?limit=150&before=${items[items.length - 1].ts}`);
    setItems([...items, ...next]);
    setMore(next.length === 150);
  }

  const groups = useMemo(() => {
    const out: { label: string; items: ActivityItem[] }[] = [];
    for (const it of items ?? []) {
      if (filter === 'flagged' && !['denied', 'blocked', 'error', 'approved'].includes(it.status)) continue;
      const label = dayLabel(it.ts);
      const g = out[out.length - 1];
      if (g?.label === label) g.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  }, [items, filter]);

  return (
    <>
      <TopBar title="Activity" />
      <Page width="lg">
        <PageIntro
          title="Activity"
          description="An audit log of every action the agent and its sub-agents took, what you approved, and what was blocked."
          actions={<Segmented id="act" size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'flagged', label: 'Approvals & errors' }]} />}
        />
        {items && !groups.length ? (
          <Empty icon={<ActivityIcon className="size-4" />} title="Nothing logged" body="Every tool call is recorded here with its input, output and outcome." />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.label}>
                <h2 className="mb-2 text-xs font-medium text-fg-3">{g.label}</h2>
                <Card className="overflow-hidden">
                  {g.items.map((it) => (
                    <Row key={it.id} item={it} />
                  ))}
                </Card>
              </section>
            ))}
            {more && !!items?.length && (
              <div className="flex justify-center">
                <Button size="sm" variant="ghost" onClick={() => void loadMore()}>
                  Load older
                </Button>
              </div>
            )}
          </div>
        )}
      </Page>
    </>
  );
}
