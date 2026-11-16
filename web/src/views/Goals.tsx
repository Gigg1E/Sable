import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, Check, Circle, ListChecks, MessageCircle, Play, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Segmented, Select, Sheet, Textarea, Toggle, listItem } from '../components/ui';
import { api } from '../lib/api';
import { clockTime, cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Goal, GoalStep, Schedule } from '../lib/types';

function StepIcon({ status }: { status: GoalStep['status'] }) {
  if (status === 'done')
    return (
      <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="flex size-5 items-center justify-center rounded-full bg-ok text-white">
        <svg viewBox="0 0 16 16" className="size-3">
          <motion.path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
        </svg>
      </motion.span>
    );
  if (status === 'in_progress')
    return (
      <span className="relative flex size-5 items-center justify-center">
        <motion.span className="absolute inset-0 rounded-full border-2 border-accent" animate={{ scale: [1, 1.25, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
        <span className="size-2 rounded-full bg-accent" />
      </span>
    );
  if (status === 'skipped') return <span className="flex size-5 items-center justify-center rounded-full bg-surface-3 text-[10px] text-subtle">–</span>;
  return <Circle className="size-5 text-line-strong" />;
}

function GoalCard({ goal }: { goal: Goal }) {
  const done = goal.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const pct = goal.steps.length ? Math.round((done / goal.steps.length) * 100) : goal.status === 'done' ? 100 : 0;
  const [open, setOpen] = useState(goal.status === 'active');

  async function toggleStep(i: number) {
    const steps = goal.steps.map((s, j) => (j === i ? { ...s, status: s.status === 'done' ? 'pending' : 'done' } : s)) as GoalStep[];
    await api.patch(`/goals/${goal.id}`, { steps });
  }
  async function setStatus(status: Goal['status']) {
    await api.patch(`/goals/${goal.id}`, { status });
  }

  return (
    <motion.div layout {...listItem}>
      <Card className="overflow-hidden">
        <button onClick={() => setOpen((o) => !o)} className="w-full p-4 text-left">
          <div className="flex items-start gap-3">
            <div className="relative size-11 shrink-0">
              <svg viewBox="0 0 44 44" className="size-11 -rotate-90">
                <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
                <motion.circle cx="22" cy="22" r="18" fill="none" stroke={goal.status === 'done' ? 'var(--ok)' : 'var(--accent)'} strokeWidth="4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: pct / 100 }} transition={{ type: 'spring', stiffness: 80, damping: 20 }} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">{pct}%</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-medium">{goal.title}</h3>
                {goal.status !== 'active' && <Badge tone={goal.status === 'done' ? 'ok' : goal.status === 'blocked' ? 'warn' : 'default'}>{goal.status}</Badge>}
              </div>
              {goal.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{goal.description}</p>}
              <p className="mt-1 text-xs text-subtle">
                {done}/{goal.steps.length} steps · updated {timeAgo(goal.updated_at)}
              </p>
            </div>
          </div>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="border-t border-line px-4 py-3">
                <ol className="space-y-2">
                  {goal.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <button onClick={() => void toggleStep(i)} className="mt-0.5" aria-label="Toggle step">
                        <StepIcon status={s.status} />
                      </button>
                      <div className="min-w-0">
                        <div className={cx('text-sm', s.status === 'done' && 'text-muted line-through decoration-subtle')}>{s.text}</div>
                        {s.note && <div className="text-xs text-subtle">{s.note}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  {goal.conversation_id && (
                    <Button size="sm" onClick={() => navigate(`/chat/${goal.conversation_id}`)}>
                      <MessageCircle className="size-3.5" /> Open chat
                    </Button>
                  )}
                  {goal.status !== 'done' ? (
                    <Button size="sm" variant="ghost" onClick={() => void setStatus('done')}>
                      <Check className="size-3.5" /> Mark done
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void setStatus('active')}>
                      Reopen
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => void api.del(`/goals/${goal.id}`)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describe(s: Schedule) {
  if (s.kind === 'once') return `Once · ${s.spec.at ? clockTime(Date.parse(s.spec.at)) : ''}`;
  if (s.kind === 'interval') return `Every ${s.spec.every_minutes} min`;
  if (s.kind === 'daily') return `Daily at ${s.spec.time}`;
  return `${WEEKDAYS[s.spec.weekday ?? 1]}s at ${s.spec.time}`;
}

function NewSchedule({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', prompt: '', kind: 'daily' as Schedule['kind'], time: '08:00', weekday: 1, every_minutes: 60, at: '' });
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  async function save() {
    setBusy(true);
    try {
      await api.post('/schedules', { ...form, at: form.at ? new Date(form.at).toISOString() : undefined });
      onClose();
    } catch (err) {
      toast({ title: 'Could not schedule', body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="New routine">
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Morning briefing" />
        </Field>
        <Field label="What should Sable do?" hint="Written like a message to your agent. Add “notify me” if you want to hear back.">
          <Textarea value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Check the weather and my goals, then notify me with a 3-line briefing." />
        </Field>
        <Field label="When">
          <Segmented id="kind" value={form.kind} onChange={(kind) => set({ kind })} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'interval', label: 'Every…' }, { value: 'once', label: 'Once' }]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {(form.kind === 'daily' || form.kind === 'weekly') && (
            <Field label="Time">
              <Input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
          )}
          {form.kind === 'weekly' && (
            <Field label="Day">
              <Select value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {form.kind === 'interval' && (
            <Field label="Minutes">
              <Input type="number" min={5} value={form.every_minutes} onChange={(e) => set({ every_minutes: Number(e.target.value) })} />
            </Field>
          )}
          {form.kind === 'once' && (
            <Field label="Date & time">
              <Input type="datetime-local" value={form.at} onChange={(e) => set({ at: e.target.value })} />
            </Field>
          )}
        </div>
        <Button variant="primary" className="w-full" loading={busy} disabled={!form.title || !form.prompt} onClick={() => void save()}>
          Save routine
        </Button>
      </div>
    </Sheet>
  );
}

export function GoalsView() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tab, setTab] = useState<'active' | 'all'>('active');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    void api.get<Goal[]>('/goals').then(setGoals);
    void api.get<Schedule[]>('/schedules').then(setSchedules);
  }, []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => {
      if (ev.type === 'goal.changed' || ev.type === 'schedule.changed') load();
    });
  }, [load]);

  const shown = (goals ?? []).filter((g) => tab === 'all' || g.status === 'active' || g.status === 'blocked');

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
        <PageHeader title="Goals" subtitle="Multi-step jobs Sable is working through." actions={<Segmented id="goal-tab" value={tab} onChange={setTab} options={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]} />} />
        {goals && !shown.length ? (
          <Empty icon={<ListChecks className="size-6" />} title={tab === 'active' ? 'Nothing in progress' : 'No goals yet'} body="Ask Sable for something that takes a few steps, like planning a trip or comparing options, and it'll track the plan here." />
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {shown.map((g) => (
                <GoalCard key={g.id} goal={g} />
              ))}
            </AnimatePresence>
          </div>
        )}

        <div className="mt-12">
          <PageHeader
            title="Routines"
            subtitle="Background tasks that run on a schedule, even when you're away."
            actions={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New
              </Button>
            }
          />
          {!schedules.length ? (
            <Empty icon={<CalendarClock className="size-6" />} title="No routines yet" body="Try asking: “Every morning at 7, give me a briefing with the weather and my open goals.”" />
          ) : (
            <div className="space-y-2.5">
              <AnimatePresence>
                {schedules.map((s) => (
                  <motion.div key={s.id} layout {...listItem}>
                    <Card className="flex items-center gap-3 p-4">
                      <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', s.enabled ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-subtle')}>
                        <CalendarClock className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.title}</div>
                        <div className="truncate text-xs text-muted">
                          {describe(s)}
                          {s.enabled && s.next_run ? ` · next ${clockTime(s.next_run)}` : ''}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" aria-label="Run now" onClick={() => void api.post(`/schedules/${s.id}/run`).then((r: any) => r?.runId && s.conversation_id && navigate(`/chat/${s.conversation_id}`))}>
                        <Play className="size-3.5" />
                      </Button>
                      {s.conversation_id && (
                        <Button size="sm" variant="ghost" aria-label="Open history" onClick={() => navigate(`/chat/${s.conversation_id}`)}>
                          <MessageCircle className="size-3.5" />
                        </Button>
                      )}
                      <Toggle checked={s.enabled} onChange={(v) => void api.patch(`/schedules/${s.id}`, { enabled: v })} label="Enabled" />
                      <Button size="sm" variant="ghost" className="text-danger" aria-label="Delete" onClick={() => void api.del(`/schedules/${s.id}`)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
      <NewSchedule open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
