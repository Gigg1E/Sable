import { AnimatePresence, motion } from 'motion/react';
import { AlarmClock, Check, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Reminder, ReminderCardData } from '../lib/types';
import { toLocalInput, untilText, whenText } from '../lib/when';
import { Button, Card, Field, IconButton, Input, SectionLabel, Sheet, listItem } from './ui';

/** Re-render every 30 s so "in 5 min" stays true. */
function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
}

/** Upcoming reminders, kept live. */
export function useReminders() {
  const [list, setList] = useState<Reminder[] | null>(null);
  const load = useCallback(() => void api.get<Reminder[]>('/reminders').then(setList).catch(() => setList([])), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'reminder.changed' && load());
  }, [load]);
  return { list, load };
}

/** The card in chat when the agent sets a reminder: when it goes off, and a way to cancel it. */
export function ReminderCard({ card }: { card: ReminderCardData }) {
  const { list } = useReminders();
  useTick();
  const live = list?.find((r) => r.id === card.id);
  const due = live?.due_at ?? card.due;
  const state = !list ? 'loading' : live ? 'set' : due <= Date.now() + 15_000 ? 'done' : 'cancelled';
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-2.5 flex max-w-md items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3">
      <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-lg', state === 'set' || state === 'loading' ? 'bg-accent/15 text-accent' : 'bg-panel-2 text-fg-3')}>
        {state === 'done' ? <Check className="size-4" /> : <AlarmClock className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-[13.5px] font-medium', state === 'cancelled' && 'text-fg-3 line-through')}>{live?.text ?? card.text}</div>
        <div className="truncate text-[12px] text-fg-3">
          {state === 'done' ? `Went off · ${whenText(due)}` : state === 'cancelled' ? 'Cancelled' : `${whenText(due)} · ${untilText(due)}`}
          {(live?.note ?? card.note) && state === 'set' ? ` · ${live?.note ?? card.note}` : ''}
        </div>
      </div>
      {state === 'set' && (
        <Button size="sm" variant="ghost" onClick={() => void api.del(`/reminders/${card.id}`)}>
          Cancel
        </Button>
      )}
    </motion.div>
  );
}

function ReminderSheet({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Reminder }) {
  const toast = useStore((s) => s.toast);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setText(editing?.text ?? '');
    setNote(editing?.note ?? '');
    setAt(toLocalInput(editing?.due_at ?? Date.now() + 60 * 60_000));
  }, [open, editing]);
  const quick = (mins: number) => setAt(toLocalInput(Date.now() + mins * 60_000));
  async function save() {
    setBusy(true);
    try {
      const body = { text, note: note || null, at: new Date(at).toISOString() };
      if (editing) await api.patch(`/reminders/${editing.id}`, body);
      else await api.post('/reminders', body);
      toast({ title: editing ? 'Reminder updated' : `Reminder set for ${whenText(new Date(at).getTime())}`, tone: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Could not save the reminder', body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit reminder' : 'New reminder'} description="Goes off once as a notification, then disappears.">
      <div className="space-y-4">
        <Field label="Remind me to">
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Go to class" />
        </Field>
        <Field label="When">
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              ['10 min', 10],
              ['30 min', 30],
              ['1 hour', 60],
              ['3 hours', 180],
              ['Tomorrow', 24 * 60],
            ].map(([l, m]) => (
              <button key={l} onClick={() => quick(m as number)} className="h-6 rounded-md border border-line px-2 text-[11.5px] text-fg-2 hover:bg-panel-2 hover:text-fg">
                in {l === 'Tomorrow' ? '1 day' : l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Room 204, bring the lab report" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!text.trim() || !at} onClick={() => void save()}>
            {editing ? 'Save' : 'Set reminder'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Routines page: upcoming one-off reminders above the routines. */
export function RemindersSection() {
  const { list } = useReminders();
  const [sheet, setSheet] = useState<{ editing?: Reminder } | null>(null);
  useTick();
  return (
    <section className="mb-8">
      <SectionLabel
        right={
          <Button size="sm" variant="ghost" onClick={() => setSheet({})}>
            <Plus className="size-3.5" /> New reminder
          </Button>
        }
      >
        Reminders
      </SectionLabel>
      {list && !list.length ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-3.5 text-[12.5px] text-fg-3">
          One-off reminders go here and disappear after they go off. Ask in chat: “remind me about class at 10 tonight”.
        </p>
      ) : (
        <Card className="overflow-hidden">
          <AnimatePresence initial={false}>
            {(list ?? []).map((r) => (
              <motion.div key={r.id} layout {...listItem} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <AlarmClock className="size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{r.text}</div>
                  {r.note && <div className="truncate text-[12.5px] text-fg-3">{r.note}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12.5px] text-fg-2">{whenText(r.due_at)}</div>
                  <div className="font-mono text-[11px] text-fg-3">{untilText(r.due_at)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {r.conversation_id && (
                    <IconButton label="Open the chat it was set in" onClick={() => navigate(`/chat/${r.conversation_id}`)}>
                      <MessageSquare className="size-3.5" />
                    </IconButton>
                  )}
                  <IconButton label="Edit" onClick={() => setSheet({ editing: r })}>
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton label="Cancel reminder" className="hover:text-danger" onClick={() => void api.del(`/reminders/${r.id}`)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </Card>
      )}
      <ReminderSheet open={!!sheet} editing={sheet?.editing} onClose={() => setSheet(null)} />
    </section>
  );
}
