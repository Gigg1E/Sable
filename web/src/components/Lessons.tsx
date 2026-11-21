import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { onServerEvent, useStore } from '../lib/store';
import { Button, Input, SectionLabel } from './ui';

interface Lesson {
  id: string;
  scope: string;
  text: string;
  origin: string;
  status: 'active' | 'retired';
  updated_at: number;
}
interface Status {
  enabled: boolean;
  everyDays: number;
  last: number | null;
  next: number;
  observations: number;
}

const scopeLabel = (s: string) => (s === 'all' ? 'Everywhere' : s === 'initiative' ? 'Check-ins' : s === 'plan' ? 'Planning' : s.startsWith('duty:') ? 'A duty' : s);

/** What Sable has learned from you, and its weekly self-review (docs/design/autonomy.md §5). */
export function Lessons() {
  const toast = useStore((s) => s.toast);
  const [data, setData] = useState<{ lessons: Lesson[]; status: Status } | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(() => void api.get<{ lessons: Lesson[]; status: Status }>('/lessons').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'lesson.changed' && load());
  }, [load]);
  async function act(p: Promise<unknown>, msg?: string) {
    try {
      await p;
      if (msg) toast({ title: msg });
      load();
    } catch (err) {
      toast({ title: "Couldn't do that", body: (err as Error).message, tone: 'error' });
    }
  }
  if (!data) return null;
  const active = data.lessons.filter((l) => l.status === 'active');
  const retired = data.lessons.filter((l) => l.status === 'retired');
  const st = data.status;
  return (
    <section className="mb-10">
      <SectionLabel
        right={
          <button className="text-xs text-fg-3 hover:text-fg" onClick={() => void act(api.post('/learning/review'), 'Reviewing itself now. Proposals land in your Inbox.')}>
            Review now
          </button>
        }
      >
        What Sable learned
      </SectionLabel>
      <p className="mb-3 text-[12.5px] leading-relaxed text-fg-3">
        Rules Sable follows because of what you did or said. Every {st.everyDays === 7 ? 'week' : `${st.everyDays} days`} it reviews itself and proposes new ones in your Inbox; nothing changes until you accept.{' '}
        {st.last ? `Last review ${timeAgo(st.last)}.` : 'No review yet.'} {st.observations ? `${st.observations} thing${st.observations === 1 ? '' : 's'} noted since.` : ''}
      </p>
      <div className="divide-y divide-line rounded-xl border border-line">
        <AnimatePresence initial={false}>
          {active.map((l) => (
            <motion.div key={l.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px]">{l.text}</div>
                <div className="mt-0.5 text-[11.5px] text-fg-3">
                  {scopeLabel(l.scope)} · {l.origin === 'you' ? 'you added it' : 'learned'} {timeAgo(l.updated_at)}
                </div>
              </div>
              <button className="shrink-0 text-[12px] text-fg-3 opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 pointer-coarse:opacity-100" onClick={() => void act(api.patch(`/lessons/${l.id}`, { status: 'retired' }), 'Sable will stop following that')}>
                Forget
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {!active.length && <div className="px-3.5 py-3 text-[13px] text-fg-3">Nothing yet. Sable learns from your Less / More / Never, ideas you take or turn down, corrections, and changes you make to its plan.</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void act(api.post('/lessons', { text }), 'Sable will follow that').then(() => setText(''));
          }}
          className="flex items-center gap-2 px-3.5 py-2"
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Teach it a rule: “Never plan anything before 9 on weekends”" className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
          <Button size="sm" variant="ghost" disabled={!text.trim()} type="submit">
            Add
          </Button>
        </form>
      </div>
      {!!retired.length && (
        <details className="mt-2 text-[12.5px] text-fg-3">
          <summary className="cursor-pointer hover:text-fg">{retired.length} forgotten</summary>
          <div className="mt-1 space-y-1">
            {retired.map((l) => (
              <div key={l.id} className={cx('flex items-center gap-3')}>
                <span className="min-w-0 flex-1 truncate line-through">{l.text}</span>
                <button className="hover:text-fg" onClick={() => void act(api.patch(`/lessons/${l.id}`, { status: 'active' }))}>
                  Restore
                </button>
                <button className="hover:text-danger" onClick={() => void act(api.del(`/lessons/${l.id}`))}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
