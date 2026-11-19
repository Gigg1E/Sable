import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, Check, ChevronRight, ListChecks, MessageSquare, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, IconButton, Input, Page, PageIntro, Progress, Segmented, Select, Sheet, Textarea, Tip, Toggle, TopBar, listItem } from '../components/ui';
import { api } from '../lib/api';
import { clockTime, cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Goal, GoalStep, Schedule } from '../lib/types';

function StepMark({ status }: { status: GoalStep['status'] }) {
  if (status === 'done')
    return (
      <span className="flex size-4 items-center justify-center rounded-[5px] bg-fg text-bg">
        <svg viewBox="0 0 16 16" className="size-3">
          <motion.path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
        </svg>
      </span>
    );
  if (status === 'in_progress')
    return (
      <span className="flex size-4 items-center justify-center rounded-[5px] border border-info">
        <motion.span className="size-1.5 rounded-full bg-info" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
      </span>
    );
  if (status === 'skipped') return <span className="flex size-4 items-center justify-center rounded-[5px] border border-line-strong text-[10px] text-fg-3">–</span>;
  return <span className="size-4 rounded-[5px] border border-line-strong" />;
}

const STATUS_TONE = { active: 'info', done: 'ok', blocked: 'accent', cancelled: 'default' } as const;

function GoalRow({ goal }: { goal: Goal }) {
  const done = goal.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const pct = goal.steps.length ? (done / goal.steps.length) * 100 : goal.status === 'done' ? 100 : 0;
  const [open, setOpen] = useState(false);

  async function toggleStep(i: number) {
    const steps = goal.steps.map((s, j) => (j === i ? { ...s, status: s.status === 'done' ? 'pending' : 'done' } : s)) as GoalStep[];
    await api.patch(`/goals/${goal.id}`, { steps });
  }

  return (
    <motion.div layout {...listItem} className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel-2/50">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-fg-3">
          <ChevronRight className="size-3.5" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{goal.title}</span>
            <Badge tone={STATUS_TONE[goal.status]}>{goal.status}</Badge>
          </div>
          {goal.description && <div className="mt-0.5 truncate text-[12.5px] text-fg-3">{goal.description}</div>}
        </div>
        <span className="hidden w-28 sm:block">
          <Progress value={pct} tone={goal.status === 'done' ? 'ok' : 'fg'} />
        </span>
        <span className="w-10 text-right font-mono text-[11px] text-fg-3 tabular">
          {done}/{goal.steps.length}
        </span>
        <span className="hidden w-16 text-right font-mono text-[11px] text-fg-3 md:block">{timeAgo(goal.updated_at)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="pb-4 pl-11 pr-4">
              <ol className="space-y-2">
                {goal.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <button onClick={() => void toggleStep(i)} className="mt-0.5" aria-label="Toggle step">
                      <StepMark status={s.status} />
                    </button>
                    <div className="min-w-0">
                      <div className={cx('text-[13px]', s.status === 'done' && 'text-fg-3 line-through decoration-fg-3/50')}>{s.text}</div>
                      {s.note && <div className="text-[12px] text-fg-3">{s.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {goal.conversation_id && (
                  <Button size="sm" onClick={() => navigate(`/chat/${goal.conversation_id}`)}>
                    <MessageSquare className="size-3.5" /> Open chat
                  </Button>
                )}
                {goal.status !== 'done' ? (
                  <Button size="sm" variant="ghost" onClick={() => void api.patch(`/goals/${goal.id}`, { status: 'done' })}>
                    <Check className="size-3.5" /> Mark done
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void api.patch(`/goals/${goal.id}`, { status: 'active' })}>
                    <RotateCcw className="size-3.5" /> Reopen
                  </Button>
                )}
                <span className="flex-1" />
                <IconButton label="Delete goal" className="hover:text-danger" onClick={() => void api.del(`/goals/${goal.id}`)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function GoalsView() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [tab, setTab] = useState<'active' | 'done' | 'all'>('active');
  const load = useCallback(() => void api.get<Goal[]>('/goals').then(setGoals), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'goal.changed' && load());
  }, [load]);

  const shown = (goals ?? []).filter((g) => tab === 'all' || (tab === 'done' ? g.status === 'done' || g.status === 'cancelled' : g.status === 'active' || g.status === 'blocked'));
  const counts = { active: (goals ?? []).filter((g) => g.status === 'active' || g.status === 'blocked').length, done: (goals ?? []).filter((g) => g.status === 'done').length };

  return (
    <>
      <TopBar title="Goals" />
      <Page width="lg">
        <PageIntro
          title="Goals"
          description="Multi-step jobs the agent plans and works through. Expand one to see or tick off its steps."
          actions={
            <Segmented
              id="goal-tab"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'active', label: `Active ${counts.active || ''}` },
                { value: 'done', label: 'Done' },
                { value: 'all', label: 'All' },
              ]}
            />
          }
        />
        {goals && !shown.length ? (
          <Empty icon={<ListChecks className="size-4" />} title={tab === 'active' ? 'Nothing in progress' : 'No goals here'} body="Ask for something that takes a few steps, like planning a trip or comparing options, and the plan is tracked here." />
        ) : (
          <Card className="overflow-hidden">
            <div className="hidden items-center gap-3 border-b border-line bg-panel-2/50 px-4 py-2 font-mono text-[10.5px] text-fg-3 sm:flex">
              <span className="w-3.5" />
              <span className="flex-1">Goal</span>
              <span className="w-28">Progress</span>
              <span className="w-10 text-right">Steps</span>
              <span className="hidden w-16 text-right md:block">Updated</span>
            </div>
            <AnimatePresence initial={false}>
              {shown.map((g) => (
                <GoalRow key={g.id} goal={g} />
              ))}
            </AnimatePresence>
          </Card>
        )}
      </Page>
    </>
  );
}

// ───────────────────────── Routines ─────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describe(s: Schedule) {
  if (s.kind === 'once') return `Once, ${s.spec.at ? clockTime(Date.parse(s.spec.at)) : ''}`;
  if (s.kind === 'interval') return `Every ${s.spec.every_minutes} min`;
  if (s.kind === 'daily') return `Daily at ${s.spec.time}`;
  return `${WEEKDAYS[s.spec.weekday ?? 1]}s at ${s.spec.time}`;
}

function NewRoutine({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', prompt: '', kind: 'daily' as Schedule['kind'], time: '08:00', weekday: 1, every_minutes: 60, at: '' });
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  async function save() {
    setBusy(true);
    try {
      await api.post('/schedules', { ...form, at: form.at ? new Date(form.at).toISOString() : undefined });
      toast({ title: 'Routine scheduled', tone: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Could not schedule', body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="New routine" description="Runs in the background on the server, even when no device is open.">
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Morning briefing" />
        </Field>
        <Field label="Instruction" hint="Written as a message to the agent. Add “notify me” to get a push notification with the result.">
          <Textarea value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Check the weather and my open goals, then notify me with a three-line briefing." />
        </Field>
        <Field label="Schedule">
          <Segmented id="kind" size="sm" value={form.kind} onChange={(kind) => set({ kind })} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'interval', label: 'Interval' }, { value: 'once', label: 'Once' }]} />
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
            <Field label="Every (minutes)">
              <Input type="number" min={5} value={form.every_minutes} onChange={(e) => set({ every_minutes: Number(e.target.value) })} />
            </Field>
          )}
          {form.kind === 'once' && (
            <Field label="Date and time">
              <Input type="datetime-local" value={form.at} onChange={(e) => set({ at: e.target.value })} />
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!form.title || !form.prompt} onClick={() => void save()}>
            Create routine
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function RoutinesView() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => void api.get<Schedule[]>('/schedules').then(setSchedules), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'schedule.changed' && load());
  }, [load]);

  return (
    <>
      <TopBar
        title="Routines"
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New routine
          </Button>
        }
      />
      <Page width="lg">
        <PageIntro title="Routines" description="Instructions that run on a schedule. Each routine keeps its own history chat so you can see every run." />
        {schedules && !schedules.length ? (
          <Empty
            icon={<CalendarClock className="size-4" />}
            title="No routines yet"
            body="Create one here, or just ask in chat: “Every morning at 7, brief me on the weather and my open goals.”"
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" /> New routine
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="hidden items-center gap-3 border-b border-line bg-panel-2/50 px-4 py-2 font-mono text-[10.5px] text-fg-3 md:flex">
              <span className="flex-1">Routine</span>
              <span className="w-36">Schedule</span>
              <span className="w-36">Next run</span>
              <span className="w-[132px] text-right">Actions</span>
            </div>
            <AnimatePresence initial={false}>
              {(schedules ?? []).map((s) => (
                <motion.div key={s.id} layout {...listItem} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-0 md:flex-nowrap">
                  <div className="min-w-0 flex-1 basis-full md:basis-auto">
                    <div className={cx('truncate text-[13.5px] font-medium', !s.enabled && 'text-fg-3')}>{s.title}</div>
                    <div className="truncate text-[12.5px] text-fg-3">{s.prompt}</div>
                  </div>
                  <span className="w-36 text-[12.5px] text-fg-2">{describe(s)}</span>
                  <Tip label={s.notify === 'when_new' ? 'Notifies only when the check finds something new. Click to notify every run.' : 'Notifies every run. Click to notify only when something new is found.'}>
                    <button
                      onClick={() => void api.patch(`/schedules/${s.id}`, { notify: s.notify === 'when_new' ? 'always' : 'when_new' }).then(() => load())}
                      className={cx('h-6 shrink-0 rounded-md border px-2 text-[11.5px] transition-colors', s.notify === 'when_new' ? 'border-tint/30 bg-tint-soft text-tint' : 'border-line text-fg-3 hover:text-fg-2')}
                    >
                      {s.notify === 'when_new' ? 'Only when new' : 'Every run'}
                    </button>
                  </Tip>
                  <Tip label={s.autonomy === 'auto' ? `Its runs act without asking${s.restrict?.length ? ` (except ${s.restrict.join(', ')})` : ''}; purchases always ask. Click to ask each time.` : 'Its runs ask before actions that need approval. Click to let it act on its own.'}>
                    <button
                      onClick={() => void api.patch(`/schedules/${s.id}`, { autonomy: s.autonomy === 'auto' ? 'ask' : 'auto' }).then(() => load())}
                      className={cx('h-6 shrink-0 rounded-md border px-2 text-[11.5px] transition-colors', s.autonomy === 'auto' ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line text-fg-3 hover:text-fg-2')}
                    >
                      {s.autonomy === 'auto' ? 'Runs on its own' : 'Asks first'}
                    </button>
                  </Tip>
                  <span className="w-36 font-mono text-[11.5px] text-fg-3">{s.enabled && s.next_run ? clockTime(s.next_run) : 'paused'}</span>
                  <div className="ml-auto flex w-[132px] items-center justify-end gap-0.5">
                    <IconButton label="Run now" onClick={() => void api.post<{ runId: string | null }>(`/schedules/${s.id}/run`).then(() => load())}>
                      <Play className="size-3.5" />
                    </IconButton>
                    <IconButton label="Run history" disabled={!s.conversation_id} onClick={() => s.conversation_id && navigate(`/chat/${s.conversation_id}`)}>
                      <MessageSquare className="size-3.5" />
                    </IconButton>
                    <IconButton label="Delete" className="hover:text-danger" onClick={() => void api.del(`/schedules/${s.id}`)}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                    <span className="ml-1.5">
                      <Toggle size="sm" checked={s.enabled} onChange={(v) => void api.patch(`/schedules/${s.id}`, { enabled: v })} label="Enabled" />
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </Card>
        )}
      </Page>
      <NewRoutine open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
