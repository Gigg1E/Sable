import { AnimatePresence, motion } from 'motion/react';
import { AlarmClock, Bell, CalendarClock, CheckCheck, Inbox as InboxIcon, MessageSquare, ShieldAlert, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../components/ApprovalCard';
import { Button, Card, Empty, Page, PageIntro, SectionLabel, TopBar, listItem } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Notification } from '../lib/types';

const KIND_ICON = { approval: ShieldAlert, schedule: CalendarClock, run: MessageSquare, reminder: AlarmClock } as Record<string, typeof Bell>;

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
              {notes.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell;
                return (
                  <motion.button key={n.id} layout {...listItem} onClick={() => navigate(n.link || '/')} className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-panel-2/50">
                    <span className="relative mt-0.5">
                      <Icon className="size-4 text-fg-3" />
                      {!n.read && <span className="absolute -left-2.5 top-1 size-1.5 rounded-full bg-accent" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={cx('text-[13.5px]', !n.read ? 'font-medium' : 'text-fg-2')}>{n.title}</div>
                      {n.body && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-3">{n.body}</div>}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-fg-3">{timeAgo(n.created_at)}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </Card>
        ) : (
          !approvals.length && null
        )}
      </Page>
    </>
  );
}
