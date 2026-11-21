import { AnimatePresence, motion } from 'motion/react';
import { CheckCheck, Inbox as InboxIcon, Trash2 } from 'lucide-react';
import { Signature } from '../components/Signature';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../components/ApprovalCard';
import { Button, Card, Empty, Page, PageIntro, SectionLabel, TopBar, listItem } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Notification } from '../lib/types';


/** How the attention gate handled it, in plain words. */
function handled(n: Notification): string | null {
  if (n.verdict === 'digest') return n.pushed ? 'Sent in a digest' : 'Waiting for your next digest';
  if (n.verdict === 'log') return 'Kept quiet';
  return null;
}

const FEEDBACK: { value: 'less' | 'more' | 'never'; label: string }[] = [
  { value: 'less', label: 'Less like this' },
  { value: 'more', label: 'More like this' },
  { value: 'never', label: 'Never' },
];

function NoteRow({ n, onChange }: { n: Notification; onChange: () => void }) {
  const toast = useStore((s) => s.toast);
  const how = handled(n);
  async function send(value: 'less' | 'more' | 'never' | 'reset') {
    try {
      const r = await api.post<{ label: string }>(`/notifications/${n.id}/feedback`, { value });
      if (value !== 'reset')
        toast({
          title: value === 'never' ? `Muted: ${r.label}` : value === 'less' ? `Less from ${r.label}` : `More from ${r.label}`,
          body: value === 'never' ? 'It still runs; you just won\u2019t be pinged. Change it in Settings → Notifications.' : undefined,
        });
      onChange();
    } catch (err) {
      toast({ title: "Couldn't save that", body: (err as Error).message, tone: 'error' });
    }
  }
  return (
    <motion.div layout {...listItem} className="group flex w-full items-start gap-3 border-b border-line px-4 py-3 last:border-0">
      <button onClick={() => navigate(n.link || '/')} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className="relative">
          <Signature kind={n.kind} size={30} play={!n.read} />
          {!n.read && <span className="absolute -left-2 top-3 size-1.5 rounded-full bg-accent" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cx('text-[13.5px]', !n.read ? 'font-medium' : 'text-fg-2')}>{n.title}</div>
          {n.body && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-3">{n.body}</div>}
          {(how || n.why) && (
            <div className="mt-1 text-[11.5px] text-fg-3">
              {how}
              {how && n.why ? ': ' : ''}
              {n.why}
            </div>
          )}
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11.5px] tabular-nums text-fg-3">{timeAgo(n.created_at)}</span>
        {n.source &&
          (n.feedback ? (
            <button onClick={() => void send('reset')} className="text-[11.5px] text-fg-3 hover:text-fg">
              {n.feedback === 'never' ? 'Muted' : n.feedback === 'less' ? 'Less' : 'More'} · Undo
            </button>
          ) : (
            <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100 focus-within:opacity-100">
              {FEEDBACK.map((f) => (
                <button key={f.value} onClick={() => void send(f.value)} className="text-[11.5px] text-fg-3 hover:text-fg">
                  {f.value === 'never' ? f.label : f.label.split(' ')[0]}
                </button>
              ))}
            </div>
          ))}
      </div>
    </motion.div>
  );
}

interface Suggestion {
  id: string;
  title: string;
  why: string;
  action: string;
  kind: 'task' | 'duty' | 'lesson' | 'duty_edit';
  payload: string | null;
  created_at: number;
}

/** An idea Sable had on its own: Do it / Not now / Never. */
/** A change the self-review proposes: a lesson, or a better version of a duty. */
function ProposalCard({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const toast = useStore((st) => st.toast);
  const p = (() => {
    try {
      return JSON.parse(s.payload ?? '{}') as { before?: string; after?: string; text?: string; field?: string };
    } catch {
      return {};
    }
  })();
  async function decide(decision: 'accept' | 'decline') {
    try {
      await api.post(`/suggestions/${s.id}`, { decision });
      toast({ title: decision === 'accept' ? 'Done. Sable will work this way now' : 'Kept as it was' });
      onDone();
    } catch (err) {
      toast({ title: "Couldn't do that", body: (err as Error).message, tone: 'error' });
    }
  }
  return (
    <motion.div layout {...listItem} className="rounded-xl border border-line px-4 py-3.5">
      <div className="text-[14px] font-medium">{s.title}</div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{s.why}</p>
      {s.kind === 'duty_edit' && p.before != null && (
        <div className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div className="rounded-lg border border-line px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-fg-3">Now</div>
            <p className="whitespace-pre-wrap text-fg-3 line-through decoration-fg-3/40">{p.before || '(empty)'}</p>
          </div>
          <div className="rounded-lg border border-accent/40 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-accent">Proposed</div>
            <p className="whitespace-pre-wrap">{p.after}</p>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => void decide('accept')}>
          Accept
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void decide('decline')}>
          Reject
        </Button>
      </div>
    </motion.div>
  );
}

function SuggestionCard({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const toast = useStore((st) => st.toast);
  const [busy, setBusy] = useState(false);
  async function decide(decision: 'accept' | 'decline' | 'never') {
    setBusy(true);
    try {
      const r = await api.post<{ conversation_id: string | null }>(`/suggestions/${s.id}`, { decision });
      if (decision === 'accept') toast({ title: 'On it', body: s.title, tone: 'success' });
      else if (decision === 'never') toast({ title: 'Won’t suggest that again' });
      onDone();
      void r;
    } catch (err) {
      toast({ title: "Couldn't do that", body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <motion.div layout {...listItem} className="rounded-xl border border-line px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Signature kind="suggestion" size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">{s.title}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{s.why}</p>
          <details className="mt-1 text-[12px] text-fg-3">
            <summary className="cursor-pointer hover:text-fg">{s.kind === 'duty' ? 'What Sable would take on' : 'What Sable would do'}</summary>
            <p className="mt-1 whitespace-pre-wrap text-fg-2">{s.action}</p>
          </details>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void decide('accept')}>
              Do it
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide('decline')}>
              Not now
            </Button>
            <button disabled={busy} onClick={() => void decide('never')} className="ml-auto text-[12.5px] text-fg-3 hover:text-fg">
              Never
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function InboxView() {
  const approvals = useStore((s) => s.approvals);
  const conversations = useStore((s) => s.conversations);
  const [notes, setNotes] = useState<Notification[] | null>(null);
  const [ideas, setIdeas] = useState<Suggestion[]>([]);
  const load = useCallback(() => {
    void api.get<Notification[]>('/notifications').then(setNotes);
    void api.get<Suggestion[]>('/suggestions').then(setIdeas);
  }, []);
  const done = (notes ?? []).filter((n) => n.kind === 'done');
  const rest = (notes ?? []).filter((n) => n.kind !== 'done' && n.kind !== 'suggestion');

  useEffect(() => {
    load();
    const off = onServerEvent((ev) => (ev.type === 'notification' || ev.type === 'suggestion.changed') && load());
    const t = setTimeout(() => void api.post('/notifications/read'), 1500);
    return () => {
      off();
      clearTimeout(t);
    };
  }, [load]);

  return (
    <>
      <TopBar
        title="Inbox"
        actions={
          !!notes?.length && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void api.post('/notifications/read').then(load)}>
                <CheckCheck className="size-3.5" /> Mark all read
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.del('/notifications').then(load)}>
                <Trash2 className="size-3.5" /> Clear
              </Button>
            </>
          )
        }
      />
      <Page width="md">
        <PageIntro title="Inbox" description="What needs your OK, ideas Sable had on its own, what it handled for you, and everything it reported while you were away." />
        <AnimatePresence>
          {approvals.length > 0 && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-10">
              <SectionLabel>
                <span className="text-accent">Needs your approval · {approvals.length}</span>
              </SectionLabel>
              <div className="space-y-3">
                <AnimatePresence>
                  {approvals.map((a) => (
                    <ApprovalCard key={a.id} approval={a} context={conversations.find((c) => c.id === a.conversation_id)?.title} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {ideas.some((s) => s.kind === 'lesson' || s.kind === 'duty_edit') && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-10">
              <SectionLabel>Sable wants to improve</SectionLabel>
              <div className="space-y-3">
                <AnimatePresence>
                  {ideas
                    .filter((s) => s.kind === 'lesson' || s.kind === 'duty_edit')
                    .map((s) => (
                      <ProposalCard key={s.id} s={s} onDone={load} />
                    ))}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
          {ideas.some((s) => s.kind === 'task' || s.kind === 'duty') && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-10">
              <SectionLabel>Ideas from Sable</SectionLabel>
              <div className="space-y-3">
                <AnimatePresence>
                  {ideas.filter((s) => s.kind === 'task' || s.kind === 'duty').map((s) => (
                    <SuggestionCard key={s.id} s={s} onDone={load} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {done.length > 0 && (
          <section className="mb-10">
            <SectionLabel>Done for you</SectionLabel>
            <Card className="divide-y divide-line">
              {done.slice(0, 8).map((n) => (
                <button key={n.id} onClick={() => navigate(n.link || '/')} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-panel-2/50">
                  <Signature kind="done" size={26} play={false} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px]">{n.title}</div>
                    {n.body && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-3">{n.body}</div>}
                  </div>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-fg-3">{timeAgo(n.created_at)}</span>
                </button>
              ))}
            </Card>
          </section>
        )}

        <SectionLabel>Notifications</SectionLabel>
        {notes && !rest.length && !approvals.length && !ideas.length ? (
          <Empty icon={<InboxIcon className="size-4" />} title="All caught up" body="Background results and approval requests show up here and as push notifications on your devices." />
        ) : rest.length ? (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {rest.map((n) => (
                <NoteRow key={n.id} n={n} onChange={load} />
              ))}
            </AnimatePresence>
          </Card>
        ) : (
          !approvals.length && null
        )}
      </Page>
    </>
  );
}
