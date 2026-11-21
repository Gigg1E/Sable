import { AnimatePresence, motion } from 'motion/react';
import { AlarmClock, AtSign, Calendar, CalendarCheck2, ChevronLeft, ChevronRight, Inbox, Plus, Radar, Repeat, Reply, Send, Sparkles, Target, Webhook } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SableCharacter } from '../components/SableCharacter';
import { Button, Field, Input, Page, SectionLabel, Segmented, Sheet, Textarea, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';

/**
 * The plan: everything Sable intends to do, and the time it blocked out for you, in one place
 * (docs/design/plan.md). Duty timers, reminders, follow-ups, check-ins and digests are merged in;
 * your calendar sits alongside for context; watchers and webhooks are listed as "always on".
 */

interface AgendaItem {
  key: string;
  kind: 'plan' | 'duty' | 'reminder' | 'followup' | 'checkin' | 'digest' | 'event';
  who: 'sable' | 'you';
  title: string;
  at: number;
  end?: number | null;
  detail?: string;
  status?: string;
  ref?: { type: 'plan' | 'schedule' | 'reminder' | 'duty'; id: string };
  approx?: boolean;
  allDay?: boolean;
}
interface AlwaysOn {
  kind: 'watcher' | 'webhook' | 'mail' | 'interval';
  title: string;
  detail: string;
  link: string;
}

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (t: number, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayName = (t: number) => {
  const diff = Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
};
const dateLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const toLocalInput = (t: number) => {
  const d = new Date(t);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

const KIND: Record<AgendaItem['kind'], { icon: typeof Calendar; label: string }> = {
  plan: { icon: CalendarCheck2, label: 'Plan' },
  duty: { icon: Target, label: 'Duty' },
  reminder: { icon: AlarmClock, label: 'Reminder' },
  followup: { icon: Reply, label: 'Follow-up' },
  checkin: { icon: Sparkles, label: 'Check-in' },
  digest: { icon: Inbox, label: 'Digest' },
  event: { icon: Calendar, label: 'Your calendar' },
};
const ALWAYS_ICON = { watcher: Radar, webhook: Webhook, mail: AtSign, interval: Repeat };

function Row({ it, onChange, compact }: { it: AgendaItem; onChange: () => void; compact?: boolean }) {
  const toast = useStore((s) => s.toast);
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(toLocalInput(it.at));
  const K = KIND[it.kind];
  const done = it.status === 'done' || it.status === 'skipped';
  const past = (it.end ?? it.at) < Date.now();

  async function act(p: Promise<unknown>, msg?: string) {
    try {
      await p;
      if (msg) toast({ title: msg });
      onChange();
    } catch (err) {
      toast({ title: "Couldn't change that", body: (err as Error).message, tone: 'error' });
    }
  }
  const scheduleId = it.kind === 'duty' ? it.key.split(':')[1] : null;

  if (compact)
    return (
      <div className={cx('flex items-baseline gap-1.5 text-[12px] leading-snug', it.kind === 'event' ? 'text-fg-3' : 'text-fg-2', done && 'line-through opacity-60')}>
        <span className="shrink-0 tabular-nums text-fg-3">{it.allDay ? 'all day' : time(it.at)}</span>
        <span className={cx('min-w-0 truncate', it.who === 'you' && it.kind !== 'event' && 'font-medium text-fg')}>{it.title}</span>
      </div>
    );

  // Sable's own machinery (check-ins, digests) is one quiet line: present, never in the way.
  if (it.kind === 'checkin' || it.kind === 'digest')
    return (
      <div className={cx('flex items-center gap-3 px-2 py-1 text-[12px] text-fg-3', past && 'opacity-55')}>
        <span className="w-[68px] shrink-0 text-right tabular-nums">
          {it.approx && '~'}
          {time(it.at)}
        </span>
        <span className="w-0.5 shrink-0" />
        <K.icon className="size-3 shrink-0" />
        <span>{it.kind === 'checkin' ? 'Check-in' : 'Digest'}</span>
      </div>
    );

  return (
    <motion.div layout className={cx('group flex flex-wrap gap-x-3 rounded-lg px-2 py-2 sm:flex-nowrap', it.kind === 'event' && 'opacity-70', (past || done) && 'opacity-55')}>
      <div className="w-[68px] shrink-0 pt-0.5 text-right text-[12.5px] tabular-nums text-fg-3">
        {it.allDay ? 'All day' : (
          <>
            {it.approx && '~'}
            {time(it.at)}
            {it.end && <div className="text-[11px]">{time(it.end)}</div>}
          </>
        )}
      </div>
      <div className={cx('w-0.5 shrink-0 rounded-full', it.kind === 'event' ? 'bg-line-strong' : it.who === 'you' ? 'bg-accent' : 'bg-tint')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <K.icon className="size-3.5 shrink-0 text-fg-3" />
          <span className={cx('min-w-0 truncate text-[13.5px]', it.who === 'you' && it.kind !== 'event' && 'font-medium', done && 'line-through')}>{it.title}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-fg-3">
          {it.kind === 'event' ? `Your calendar${it.detail ? ` · ${it.detail}` : ''}` : `${it.who === 'you' ? 'For you' : 'Sable'} · ${K.label}${it.detail ? ` · ${it.detail}` : ''}`}
          {it.status === 'done' && ' · done'}
          {it.status === 'skipped' && ' · skipped'}
        </div>
        {moving && it.ref?.type === 'plan' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <Button
              size="sm"
              onClick={() => {
                const start = new Date(when).getTime();
                const len = it.end ? it.end - it.at : null;
                void act(api.patch(`/plan/${it.ref!.id}`, { start, end: len ? start + len : null }), 'Moved');
                setMoving(false);
              }}
            >
              Move
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMoving(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-2.5 pt-0.5 text-[12px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 max-sm:w-full max-sm:pl-[82px] max-sm:empty:hidden">
        {it.ref?.type === 'plan' && !done && (
          <>
            {it.who === 'you' && (
              <button className="text-fg-2 hover:text-fg" onClick={() => void act(api.patch(`/plan/${it.ref!.id}`, { status: 'done' }), 'Marked done')}>
                Done
              </button>
            )}
            <button className="text-fg-2 hover:text-fg" onClick={() => setMoving((m) => !m)}>
              Move
            </button>
            <button className="text-fg-2 hover:text-fg" onClick={() => void act(api.patch(`/plan/${it.ref!.id}`, { status: 'skipped' }), 'Skipped')}>
              Skip
            </button>
            <button className="text-fg-3 hover:text-danger" onClick={() => void act(api.del(`/plan/${it.ref!.id}`), 'Removed from the plan')}>
              Remove
            </button>
          </>
        )}
        {it.kind === 'duty' && scheduleId && !past && (
          <button className="text-fg-2 hover:text-fg" onClick={() => void act(api.post(`/schedules/${scheduleId}/skip`), 'Skipped this one')}>
            Skip this one
          </button>
        )}
        {it.ref?.type === 'duty' && (
          <button className="text-fg-2 hover:text-fg" onClick={() => navigate('/duties')}>
            Duty
          </button>
        )}
        {it.ref?.type === 'reminder' && (
          <button className="text-fg-3 hover:text-danger" onClick={() => void act(api.del(`/reminders/${it.ref!.id}`), 'Removed')}>
            Remove
          </button>
        )}
      </div>
    </motion.div>
  );
}

function NewBlock({ open, onClose, day, onDone }: { open: boolean; onClose: () => void; day: number; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const base = Math.max(Date.now() + 15 * 60_000, day + 9 * 3600_000);
  const rounded = Math.ceil(base / (15 * 60_000)) * 15 * 60_000;
  const [who, setWho] = useState<'you' | 'sable'>('you');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(toLocalInput(rounded));
  const [end, setEnd] = useState(toLocalInput(rounded + 3600_000));
  const [notes, setNotes] = useState('');
  async function save() {
    try {
      await api.post('/plan', { who, title, start: new Date(start).getTime(), end: end ? new Date(end).getTime() : null, notes });
      toast({ title: who === 'you' ? 'Time blocked' : 'Added to Sable’s plan' });
      onDone();
      onClose();
      setTitle('');
      setNotes('');
    } catch (err) {
      toast({ title: "Couldn't add it", body: (err as Error).message, tone: 'error' });
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Add to the plan">
      <div className="space-y-4">
        <Segmented id="nb-who" value={who} onChange={setWho} options={[{ value: 'you', label: 'Time for me' }, { value: 'sable', label: 'For Sable to do' }]} />
        <Field label={who === 'you' ? 'What you’ll do' : 'What Sable should do'}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={who === 'you' ? 'Math assignment' : 'Check whether the refund landed'} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {who === 'sable' && (
          <Field label="Details" hint="Everything Sable needs to do it then.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim()} onClick={() => void save()}>
            Add
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function PlanView() {
  const toast = useStore((s) => s.toast);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [data, setData] = useState<{ items: AgendaItem[]; alwaysOn: AlwaysOn[]; calendarErrors: string[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [say, setSay] = useState('');
  const [sending, setSending] = useState(false);

  // Week: the next 7 days from the chosen day (what's coming matters more than what's past).
  const range = useMemo(() => ({ from: anchor, to: addDays(anchor, view === 'day' ? 1 : 7) }), [view, anchor]);
  const load = useCallback(() => void api.get<typeof data>(`/agenda?from=${range.from}&to=${range.to}`).then(setData).catch(() => {}), [range]);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ['plan.changed', 'schedule.changed', 'duty.changed', 'reminder.changed', 'initiative.changed'].includes(ev.type) && load());
  }, [load]);

  async function send() {
    if (!say.trim()) return;
    setSending(true);
    try {
      await api.post<{ conversationId: string }>('/plan/feedback', { text: say });
      toast({ title: 'Sable is on it', body: 'It’s fixing the plan in Main; you’ll see the changes here.' });
      setSay('');
    } catch (err) {
      toast({ title: "Couldn't send that", body: (err as Error).message, tone: 'error' });
    } finally {
      setSending(false);
    }
  }

  const items = data?.items ?? [];
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : [anchor];
  const forDay = (d: number) => items.filter((i) => i.at >= d && i.at < addDays(d, 1));
  const step = view === 'day' ? 1 : 7;
  const heading = view === 'day' ? `${dayName(anchor)}, ${dateLabel(anchor)}` : `${dayName(anchor) === 'Today' ? 'This week' : 'Week'}: ${dateLabel(range.from)} – ${dateLabel(addDays(range.to, -1))}`;
  const mine = items.filter((i) => i.who === 'sable' && i.kind !== 'digest' && i.kind !== 'checkin').length;
  const yours = items.filter((i) => i.who === 'you' && i.kind !== 'event').length;

  return (
    <>
      <TopBar
        title="Plan"
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        }
      />
      <Page width="lg">
        <div className="flex flex-wrap items-center gap-3">
          <SableCharacter size={34} mood="idle" className="text-fg" />
          <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-46px)]">
            <h1 className="voice text-[22px] font-semibold leading-tight">{heading}</h1>
            <p className="text-[12.5px] text-fg-3">
              {mine} thing{mine === 1 ? '' : 's'} Sable will do · {yours} block{yours === 1 ? '' : 's'} for you
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="Earlier" className="rounded-md p-1.5 text-fg-2 hover:bg-panel-2" onClick={() => setAnchor((a) => addDays(a, -step))}>
              <ChevronLeft className="size-4" />
            </button>
            <button className="rounded-md px-2 py-1 text-[12.5px] text-fg-2 hover:bg-panel-2" onClick={() => setAnchor(startOfDay(Date.now()))}>
              Today
            </button>
            <button aria-label="Later" className="rounded-md p-1.5 text-fg-2 hover:bg-panel-2" onClick={() => setAnchor((a) => addDays(a, step))}>
              <ChevronRight className="size-4" />
            </button>
          </div>
          <Segmented id="plan-view" size="sm" value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
        </div>

        {/* Talk to it about the plan. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="mt-4 flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 focus-within:border-line-strong"
        >
          <input value={say} onChange={(e) => setSay(e.target.value)} placeholder="Something looks wrong? Tell Sable: “move my study block to 9 pm”, “don’t plan anything before 10 on Saturdays”" className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-3" />
          <button type="submit" disabled={!say.trim() || sending} className="rounded-md p-1.5 text-fg-2 hover:text-fg disabled:opacity-40" aria-label="Send to Sable">
            <Send className="size-4" />
          </button>
        </form>

        {view === 'day' ? (
          <div className="mt-5">
            {!data ? null : forDay(anchor).length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
                <p className="voice text-[17px] font-semibold">Nothing planned{dayName(anchor) === 'Today' ? ' today' : ''}.</p>
                <p className="mt-1 text-[13px] text-fg-3">Sable fills this in as it learns your days. You can also add something, or just tell it what you need.</p>
              </div>
            ) : (
              <div className="space-y-px">
                {forDay(anchor).map((it, i, arr) => {
                  const nowLine = startOfDay(Date.now()) === anchor && it.at > Date.now() && (i === 0 || arr[i - 1].at <= Date.now());
                  return (
                    <div key={it.key}>
                      {nowLine && (
                        <div className="my-1 flex items-center gap-2 pl-[78px] text-[11px] font-medium text-accent">
                          Now <span className="h-px flex-1 bg-accent/50" />
                        </div>
                      )}
                      <Row it={it} onChange={load} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {days.map((d) => {
              const all = forDay(d).filter((i) => i.kind !== 'digest');
              const checkins = all.filter((i) => i.kind === 'checkin').length;
              const list = all.filter((i) => i.kind !== 'checkin');
              const today = d === startOfDay(Date.now());
              return (
                <section key={d}>
                  <button onClick={() => (setAnchor(d), setView('day'))} className="mb-1 flex items-baseline gap-2 text-left hover:underline">
                    <span className={cx('text-[14px] font-medium', today && 'text-accent')}>{dayName(d)}</span>
                    <span className="text-[12px] text-fg-3">{dateLabel(d)}</span>
                    {checkins > 0 && <span className="text-[12px] text-fg-3">· {checkins} check-in{checkins === 1 ? '' : 's'}</span>}
                  </button>
                  {list.length ? (
                    <div className="space-y-px">
                      {list.map((it) => (
                        <Row key={it.key} it={it} onChange={load} />
                      ))}
                    </div>
                  ) : (
                    <p className="py-1.5 pl-[86px] text-[12.5px] text-fg-3">Nothing planned</p>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {!!data?.calendarErrors.length && <p className="mt-3 text-[12px] text-fg-3">Some calendars couldn’t be read: {data.calendarErrors.join('; ')}</p>}

        <AnimatePresence>
          {!!data?.alwaysOn.length && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10">
              <SectionLabel>Always on</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {data.alwaysOn.map((a) => {
                  const Icon = ALWAYS_ICON[a.kind];
                  return (
                    <button key={a.kind + a.title} onClick={() => navigate(a.link)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-left hover:border-line-strong">
                      <Icon className="size-3.5 text-fg-3" />
                      <span className="text-[13px]">{a.title}</span>
                      <span className="text-[12px] text-fg-3">{a.detail}</span>
                    </button>
                  );
                })}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </Page>
      <NewBlock open={adding} onClose={() => setAdding(false)} day={anchor} onDone={load} />
    </>
  );
}
