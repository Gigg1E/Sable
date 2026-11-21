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

export function InboxView() {
  const approvals = useStore((s) => s.approvals);
  const conversations = useStore((s) => s.conversations);
  const [notes, setNotes] = useState<Notification[] | null>(null);
  const load = useCallback(() => void api.get<Notification[]>('/notifications').then(setNotes), []);

  useEffect(() => {
    load();
    const off = onServerEvent((ev) => ev.type === 'notification' && load());
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
        <PageIntro title="Inbox" description="Approvals waiting on you, and everything the agent reported while you were away." />
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

        <SectionLabel>Notifications</SectionLabel>
        {notes && !notes.length && !approvals.length ? (
          <Empty icon={<InboxIcon className="size-4" />} title="All caught up" body="Background results and approval requests show up here and as push notifications on your devices." />
        ) : notes && notes.length ? (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {notes.map((n) => (
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
