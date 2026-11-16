import { AnimatePresence, motion } from 'motion/react';
import { Bell, CheckCheck, Inbox as InboxIcon, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../components/ApprovalCard';
import { Button, Card, Empty, PageHeader, listItem } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Notification } from '../lib/types';

export function InboxView() {
  const approvals = useStore((s) => s.approvals);
  const conversations = useStore((s) => s.conversations);
  const [notes, setNotes] = useState<Notification[]>([]);
  const load = useCallback(() => void api.get<Notification[]>('/notifications').then(setNotes), []);

  useEffect(() => {
    load();
    const off = onServerEvent((ev) => ev.type === 'notification' && load());
    // Opening the inbox marks everything read.
    const t = setTimeout(() => void api.post('/notifications/read'), 1200);
    return () => {
      off();
      clearTimeout(t);
    };
  }, [load]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
        <PageHeader title="Inbox" subtitle="Approvals waiting on you, and everything Sable told you." />

        <AnimatePresence>
          {approvals.length > 0 && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="mb-10">
              <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wider text-warn">Needs your OK · {approvals.length}</h2>
              <div className="space-y-3">
                <AnimatePresence>
                  {approvals.map((a) => (
                    <div key={a.id}>
                      <ApprovalCard approval={a} />
                      <button onClick={() => navigate(`/chat/${a.conversation_id}`)} className="mt-1.5 pl-1 text-xs text-subtle hover:text-fg">
                        in “{conversations.find((c) => c.id === a.conversation_id)?.title ?? 'chat'}” · {timeAgo(a.created_at)}
                      </button>
                    </div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium uppercase tracking-wider text-subtle">Notifications</h2>
          {notes.length > 0 && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => void api.post('/notifications/read').then(load)}>
                <CheckCheck className="size-3.5" /> Read all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.del('/notifications').then(load)}>
                <Trash2 className="size-3.5" /> Clear
              </Button>
            </div>
          )}
        </div>
        {!notes.length && !approvals.length ? (
          <Empty icon={<InboxIcon className="size-6" />} title="All clear" body="When Sable finishes background work or needs a decision, it shows up here and on your devices." />
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {notes.map((n) => (
                <motion.div key={n.id} layout {...listItem}>
                  <Card className={cx('flex cursor-pointer items-start gap-3 p-4 transition-colors hover:border-line-strong', !n.read && 'border-accent/30')} onClick={() => navigate(n.link || '/')}>
                    <div className={cx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl', n.read ? 'bg-surface-2 text-subtle' : 'bg-accent-soft text-accent')}>
                      <Bell className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{n.title}</div>
                      {n.body && <div className="mt-0.5 line-clamp-3 text-sm text-muted">{n.body}</div>}
                      <div className="mt-1 text-xs text-subtle">{timeAgo(n.created_at)}</div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
