import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import type { Settings } from '../lib/types';

type Edit = (fn: (d: Settings) => void) => void;
type TestResult = { ok: boolean; error?: string; name?: string; upcoming?: number; next?: { title: string; start: string; allDay: boolean } | null };

const WHERE = [
  {
    name: 'Google Calendar',
    steps: 'On a computer, open calendar.google.com → Settings (gear) → under “Settings for my calendars” pick the calendar → Integrate calendar → copy “Secret address in iCal format”.',
  },
  {
    name: 'Outlook / Microsoft 365',
    steps: 'Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar → choose the calendar and “Can view all details” → Publish → copy the ICS link.',
  },
  {
    name: 'iCloud (Apple Calendar)',
    steps: 'Calendar app or icloud.com/calendar → share icon next to the calendar → turn on “Public Calendar” → copy the link (webcal:// works). Note: anyone with the link can see it.',
  },
];

export function CalendarFeedsSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [tests, setTests] = useState<Record<string, TestResult | 'busy'>>({});
  const [help, setHelp] = useState(false);
  const feeds = draft.calendars ?? [];

  return (
    <section className="mb-10">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Calendar feeds</h2>
        <Badge tone="outline">iCal · read-only</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
        The simplest way to give {draft.persona.name} your calendar: paste the private iCal address from Google, Outlook or iCloud. No developer setup and works with personal accounts. {draft.persona.name} can read events and find free time, but can't add or change events through a feed.
      </p>
      <div className="mt-4 space-y-3">
        <AnimatePresence initial={false}>
          {feeds.map((c, i) => {
            const set = (fn: (x: (typeof feeds)[number]) => void) => edit((d) => fn(d.calendars[i]));
            const t = tests[c.id];
            return (
              <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <CalendarDays className="size-4 shrink-0 text-fg-3" />
                    <Input className="!w-auto flex-1 !border-transparent !bg-transparent !px-0 !text-[14px] font-medium !shadow-none focus:!ring-0" value={c.name} onChange={(e) => set((x) => void (x.name = e.target.value))} />
                    <Toggle size="sm" checked={c.enabled} onChange={(v) => set((x) => void (x.enabled = v))} label="Enabled" />
                    <button onClick={() => edit((d) => void d.calendars.splice(i, 1))} aria-label="Remove" className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-3">
                    <Field label="Secret iCal address" hint="Keep it private: anyone with this address can read the calendar. It's stored on your server only and never shown again in full.">
                      <Input type="url" autoComplete="off" spellCheck={false} value={c.url} placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" onChange={(e) => set((x) => void (x.url = e.target.value.trim()))} />
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      size="sm"
                      loading={t === 'busy'}
                      disabled={!c.url}
                      onClick={async () => {
                        setTests((x) => ({ ...x, [c.id]: 'busy' }));
                        const r = await api.post<TestResult>('/calendars/test', c).catch((err: Error): TestResult => ({ ok: false, error: err.message }));
                        setTests((x) => ({ ...x, [c.id]: r }));
                        if (r.ok && r.name && /^Calendar( \d+)?$/.test(c.name)) set((x) => void (x.name = r.name!));
                      }}
                    >
                      Test
                    </Button>
                    {t && t !== 'busy' && (
                      <span className={cx('min-w-0 text-xs', t.ok ? 'text-ok' : 'text-danger')}>
                        {t.ok
                          ? `Works · ${t.upcoming} event${t.upcoming === 1 ? '' : 's'} in the next 30 days${t.next ? ` · next: ${t.next.title}, ${new Date(t.next.start).toLocaleString(undefined, t.next.allDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`
                          : t.error}
                      </span>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() =>
              edit((d) => {
                d.calendars ??= [];
                let n = d.calendars.length + 1;
                let id = `cal-${n}`;
                while (d.calendars.some((c) => c.id === id)) id = `cal-${++n}`;
                d.calendars.push({ id, name: d.calendars.length ? `Calendar ${n}` : 'Calendar', url: '', enabled: true });
              })
            }
          >
            <Plus className="size-3.5" /> Add calendar
          </Button>
          <button onClick={() => setHelp((v) => !v)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-2 hover:bg-panel-2 hover:text-fg">
            <motion.span animate={{ rotate: help ? 90 : 0 }} className="inline-flex">
              <ChevronRight className="size-3.5" />
            </motion.span>
            Where do I find the address?
          </button>
        </div>
        <AnimatePresence initial={false}>
          {help && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card className="space-y-2.5 p-4 text-[12.5px] leading-relaxed text-fg-2">
                {WHERE.map((w) => (
                  <p key={w.name}>
                    <b className="text-fg">{w.name}:</b> {w.steps}
                  </p>
                ))}
                <p className="text-fg-3">Feeds refresh every few minutes. Google can take a few hours to show changes in its feed. If an address stops working, the provider may have reset it: copy it again.</p>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
