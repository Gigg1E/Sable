import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Clock, MessageSquare, Pause, Play, Radar, Target, Trash2, Webhook, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Page, PageIntro, SectionLabel, Segmented, Textarea, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';

type Autonomy = 'act' | 'suggest' | 'watch';
interface Duty {
  id: string;
  title: string;
  purpose: string;
  instructions: string;
  autonomy: Autonomy;
  notify: 'always' | 'when_new';
  memory: string | null;
  conversation_id: string | null;
  status: 'active' | 'paused' | 'done';
  origin: string;
  last_run: number | null;
  runs: number;
  triggers: string[];
}
interface SignalRow {
  id: string;
  source: string;
  kind: string;
  title: string;
  created_at: number;
  duty_id: string | null;
}

const AUTONOMY: { value: Autonomy; label: string; hint: string }[] = [
  { value: 'act', label: 'Acts', hint: 'Does low-risk things itself and tells you after. Sending, buying and deleting still ask.' },
  { value: 'suggest', label: 'Suggests', hint: 'Looks, then proposes. Nothing changes until you say so.' },
  { value: 'watch', label: 'Watches', hint: 'Only observes and reports.' },
];

function triggerIcon(t: string) {
  if (t.startsWith('Watcher')) return Radar;
  if (t.startsWith('Webhook')) return Webhook;
  if (t.startsWith('Mail')) return AtSign;
  return Clock;
}
function signalIcon(kind: string) {
  return kind === 'watch' ? Radar : kind === 'hook' ? Webhook : kind === 'mail' ? AtSign : kind === 'time' ? Clock : Zap;
}

function DutyCard({ d, onChange }: { d: Duty; onChange: () => void }) {
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [memory, setMemory] = useState(d.memory ?? '');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setMemory(d.memory ?? ''), [d.memory]);

  async function patch(body: Partial<Duty>, done?: string) {
    try {
      await api.patch(`/duties/${d.id}`, body);
      if (done) toast({ title: done });
      onChange();
    } catch (err) {
      toast({ title: "Couldn't change that", body: (err as Error).message, tone: 'error' });
    }
  }
  async function runNow() {
    try {
      await api.post(`/duties/${d.id}/run`);
      toast({ title: `Running “${d.title}”`, body: 'It works in the background and reports only if there’s something worth telling.' });
      onChange();
    } catch (err) {
      toast({ title: "Couldn't run it", body: (err as Error).message, tone: 'error' });
    }
  }
  const paused = d.status === 'paused';

  return (
    <motion.div layout className={cx('rounded-xl border border-line px-4 py-3.5', paused && 'opacity-60')}>
      <div className="flex items-start gap-3 max-sm:flex-col">
        <div className="min-w-0 flex-1 max-sm:w-full">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14.5px] font-medium">{d.title}</h3>
            {paused && <span className="text-[11.5px] text-fg-3">Paused</span>}
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{d.purpose}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-3">
            {d.triggers.length ? (
              d.triggers.map((t) => {
                const Icon = triggerIcon(t);
                return (
                  <span key={t} className="flex items-center gap-1">
                    <Icon className="size-3" /> {t}
                  </span>
                );
              })
            ) : (
              <span>Nothing wakes it yet. Ask Sable to add a time, a watcher or a sender.</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <Segmented id={`aut-${d.id}`} size="sm" value={d.autonomy} options={AUTONOMY.map((a) => ({ value: a.value, label: a.label }))} onChange={(v) => void patch({ autonomy: v }, `“${d.title}” ${AUTONOMY.find((a) => a.value === v)!.label.toLowerCase()} now`)} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
        <span className="text-fg-3 tabular-nums">{d.runs ? `Ran ${d.runs} time${d.runs === 1 ? '' : 's'}${d.last_run ? `, last ${timeAgo(d.last_run)}` : ''}` : 'Hasn’t run yet'}</span>
        <span className="flex-1" />
        <button onClick={() => setOpen((o) => !o)} className="text-fg-2 hover:text-fg">
          {open ? 'Hide memory' : d.memory ? 'What it remembers' : 'Memory'}
        </button>
        {d.conversation_id && (
          <button onClick={() => navigate(`/chat/${d.conversation_id}`)} className="flex items-center gap-1 text-fg-2 hover:text-fg">
            <MessageSquare className="size-3.5" /> Chat
          </button>
        )}
        {!paused && (
          <button onClick={() => void runNow()} className="flex items-center gap-1 text-fg-2 hover:text-fg">
            <Play className="size-3.5" /> Run now
          </button>
        )}
        <button onClick={() => void patch({ status: paused ? 'active' : 'paused' }, paused ? 'Resumed' : 'Paused')} className="flex items-center gap-1 text-fg-2 hover:text-fg">
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {paused ? 'Resume' : 'Pause'}
        </button>
        {confirm ? (
          <span className="flex items-center gap-2">
            <button onClick={() => void api.del(`/duties/${d.id}`).then(onChange)} className="font-medium text-danger">
              Delete
            </button>
            <button onClick={() => setConfirm(false)} className="text-fg-3 hover:text-fg">
              Keep
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirm(true)} className="text-fg-3 hover:text-danger" aria-label="Delete duty">
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <p className="text-[12px] text-fg-3">What Sable keeps between runs, so it knows what’s new. It updates this itself; you can correct it.</p>
              <Textarea value={memory} onChange={(e) => setMemory(e.target.value)} rows={4} placeholder="Nothing yet." />
              <div className="flex justify-between gap-2">
                <details className="text-[12px] text-fg-3">
                  <summary className="cursor-pointer hover:text-fg">Instructions</summary>
                  <p className="mt-1 whitespace-pre-wrap text-fg-2">{d.instructions}</p>
                </details>
                {memory !== (d.memory ?? '') && (
                  <Button size="sm" onClick={() => void patch({ memory }, 'Memory saved')}>
                    Save memory
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function DutiesView() {
  const [data, setData] = useState<{ duties: Duty[]; signals: SignalRow[] } | null>(null);
  const load = useCallback(() => void api.get<{ duties: Duty[]; signals: SignalRow[] }>('/duties').then(setData), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => (ev.type === 'duty.changed' || ev.type === 'schedule.changed') && load());
  }, [load]);
  const titleOf = (id: string | null) => data?.duties.find((d) => d.id === id)?.title;

  return (
    <>
      <TopBar title="Duties" />
      <Page width="md">
        <PageIntro
          title="Duties"
          description="What Sable takes care of in the background. Each one has a purpose, remembers what it saw, and only reaches you when something new matters. Routines, watchers and webhooks are what wake them."
        />
        {data && !data.duties.length ? (
          <Empty icon={<Target className="size-4" />} title="No duties yet" body="Ask Sable to look after something ongoing: “track my refund until it lands”, “make sure I never miss a school deadline”, “every Friday, plan my weekend”." />
        ) : (
          <div className="space-y-3">
            {data?.duties.map((d) => (
              <DutyCard key={d.id} d={d} onChange={load} />
            ))}
          </div>
        )}

        {!!data?.signals.length && (
          <section className="mt-10">
            <SectionLabel>Lately</SectionLabel>
            <Card className="divide-y divide-line">
              {data.signals.slice(0, 15).map((s) => {
                const Icon = signalIcon(s.kind);
                return (
                  <div key={s.id} className="flex items-center gap-3 px-3.5 py-2 text-[13px]">
                    <Icon className="size-3.5 shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.duty_id && <span className="hidden max-w-[40%] truncate text-[12px] text-fg-3 sm:block">→ {titleOf(s.duty_id) ?? 'a duty'}</span>}
                    <span className="shrink-0 text-[11.5px] tabular-nums text-fg-3">{timeAgo(s.created_at)}</span>
                  </div>
                );
              })}
            </Card>
          </section>
        )}
      </Page>
    </>
  );
}
