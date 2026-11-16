import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, Brain, Inbox, LayoutGrid, ListChecks, LogOut, Menu, MessageCircle, MoreHorizontal, PenSquare, Search, Settings, Trash2, X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { navigate, usePath } from '../lib/router';
import { useStore } from '../lib/store';
import { Orb } from './Orb';
import { IconButton, Sheet } from './ui';

const NAV = [
  { to: '/', label: 'Chat', icon: MessageCircle, match: (p: string) => p === '/' || p.startsWith('/chat') },
  { to: '/goals', label: 'Goals', icon: ListChecks, match: (p: string) => p.startsWith('/goals') },
  { to: '/spaces', label: 'Spaces', icon: LayoutGrid, match: (p: string) => p.startsWith('/spaces') },
  { to: '/inbox', label: 'Inbox', icon: Inbox, match: (p: string) => p.startsWith('/inbox') },
  { to: '/activity', label: 'Activity', icon: Activity, match: (p: string) => p.startsWith('/activity') },
  { to: '/memory', label: 'Memory', icon: Brain, match: (p: string) => p.startsWith('/memory') },
  { to: '/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/settings') },
];

function useInboxCount() {
  const approvals = useStore((s) => s.approvals.length);
  const unread = useStore((s) => s.unread);
  return { approvals, total: approvals + unread };
}

function ConversationList({ onPick }: { onPick?: () => void }) {
  const conversations = useStore((s) => s.conversations);
  const runs = useStore((s) => s.runs);
  const path = usePath();
  const [q, setQ] = useState('');
  const filtered = useMemo(() => conversations.filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase())), [conversations, q]);

  async function remove(id: string) {
    await api.del(`/conversations/${id}`);
    useStore.setState((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
    if (path === `/chat/${id}`) navigate('/');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conversations.length > 6 && (
        <div className="relative mx-3 mb-2">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="h-8 w-full rounded-lg bg-surface-2 pl-8 pr-2 text-[13px] outline-none placeholder:text-subtle" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence initial={false}>
          {filtered.map((c) => {
            const active = path === `/chat/${c.id}`;
            const run = runs[c.id];
            return (
              <motion.div key={c.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="group relative">
                <button
                  onClick={() => {
                    navigate(`/chat/${c.id}`);
                    onPick?.();
                  }}
                  className={cx('relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors', active ? 'text-fg' : 'text-muted hover:text-fg hover:bg-surface-2/60')}
                >
                  {active && <motion.span layoutId="conv-active" className="absolute inset-0 rounded-xl bg-surface-2" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  {run && <Orb size={12} state={run.status === 'waiting' ? 'waiting' : 'working'} className="relative" />}
                  <span className="relative min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="relative text-[11px] text-subtle group-hover:opacity-0">{timeAgo(c.updated_at)}</span>
                </button>
                <button onClick={() => void remove(c.id)} aria-label="Delete chat" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-subtle opacity-0 hover:text-danger group-hover:opacity-100 transition-opacity">
                  <Trash2 className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {!conversations.length && <p className="px-3 py-4 text-xs text-subtle">Your chats will show up here.</p>}
      </div>
    </div>
  );
}

function Brand() {
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  const connected = useStore((s) => s.connected);
  return (
    <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
      <Orb size={26} />
      <span className="text-[17px] font-semibold tracking-tight">{name}</span>
      {!connected && <span className="text-[10px] text-warn">offline</span>}
    </button>
  );
}

async function signOut() {
  await api.post('/auth/logout').catch(() => {});
  location.href = '/';
}

function Sidebar() {
  const path = usePath();
  const { total } = useInboxCount();
  return (
    <aside className="hidden md:flex w-[264px] shrink-0 flex-col border-r border-line bg-bg-elev/80 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-4">
        <Brand />
        <IconButton label="New chat" onClick={() => navigate('/')}>
          <PenSquare className="size-4" />
        </IconButton>
      </div>
      <nav className="space-y-0.5 px-2 pb-3">
        {NAV.slice(1).map((n) => {
          const active = n.match(path);
          return (
            <button key={n.to} onClick={() => navigate(n.to)} className={cx('relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors', active ? 'text-fg' : 'text-muted hover:text-fg')}>
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-surface-2" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <n.icon className="relative size-4" />
              <span className="relative flex-1 text-left">{n.label}</span>
              {n.to === '/inbox' && total > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                  {total}
                </motion.span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="mx-4 mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-subtle">Chats</div>
      <ConversationList />
      <div className="border-t border-line p-2">
        <button onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

function MobileTop({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="pt-safe md:hidden sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="flex h-12 items-center justify-between px-2">
        <IconButton label="Chats" onClick={onMenu}>
          <Menu className="size-5" />
        </IconButton>
        <Brand />
        <IconButton label="New chat" onClick={() => navigate('/')}>
          <PenSquare className="size-5" />
        </IconButton>
      </div>
    </header>
  );
}

function MobileTabs({ onMore }: { onMore: () => void }) {
  const path = usePath();
  const { total } = useInboxCount();
  const tabs = [NAV[0], NAV[1], NAV[2], NAV[3]];
  const moreActive = NAV.slice(4).some((n) => n.match(path));
  return (
    <nav className="pb-safe md:hidden z-30 border-t border-line bg-bg/85 backdrop-blur-xl">
      <div className="grid grid-cols-5">
        {tabs.map((n) => {
          const active = n.match(path);
          return (
            <button key={n.to} onClick={() => navigate(n.to)} className={cx('relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', active ? 'text-fg' : 'text-subtle')}>
              {active && <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
              <span className="relative">
                <n.icon className="size-5" />
                {n.to === '/inbox' && total > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1 text-[9px] font-bold text-accent-fg">{total}</span>}
              </span>
              {n.label}
            </button>
          );
        })}
        <button onClick={onMore} className={cx('relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', moreActive ? 'text-fg' : 'text-subtle')}>
          {moreActive && <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
          <MoreHorizontal className="size-5" />
          More
        </button>
      </div>
    </nav>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-[max(12px,env(safe-area-inset-top))] md:items-end">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cx('pointer-events-auto w-full max-w-sm rounded-2xl border bg-surface/95 p-3.5 shadow-soft backdrop-blur-xl', t.tone === 'error' ? 'border-danger/30' : 'border-line')}
          >
            <div className="flex items-start gap-3">
              {t.tone === 'error' ? <span className="mt-1 size-2 shrink-0 rounded-full bg-danger" /> : <Orb size={18} className="mt-0.5" />}
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (t.link) navigate(t.link);
                  dismiss(t.id);
                }}
              >
                <div className="text-sm font-medium leading-snug">{t.title}</div>
                {t.body && <div className="mt-0.5 line-clamp-3 text-xs text-muted">{t.body}</div>}
              </button>
              <button onClick={() => dismiss(t.id)} className="text-subtle hover:text-fg" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Shell({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  return (
    <div className="aurora flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <MobileTop onMenu={() => setDrawer(true)} />
        <main className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={routeKey} className="absolute inset-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
        <MobileTabs onMore={() => setMore(true)} />
      </div>

      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.5, right: 0 }}
              onDragEnd={(_, info) => info.offset.x < -80 && setDrawer(false)}
              className="pt-safe pb-safe absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col border-r border-line bg-bg-elev"
            >
              <div className="flex h-12 items-center justify-between px-4">
                <span className="text-sm font-semibold">Chats</span>
                <IconButton label="Close" onClick={() => setDrawer(false)}>
                  <X className="size-4" />
                </IconButton>
              </div>
              <ConversationList onPick={() => setDrawer(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Sheet open={more} onClose={() => setMore(false)}>
        <div className="grid grid-cols-3 gap-2 pt-2">
          {[...NAV.slice(4), { to: '#signout', label: 'Sign out', icon: LogOut, match: () => false }].map((n) => (
            <motion.button
              key={n.to}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setMore(false);
                if (n.to === '#signout') void signOut();
                else navigate(n.to);
              }}
              className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-xs font-medium"
            >
              <n.icon className="size-5 text-muted" />
              {n.label}
            </motion.button>
          ))}
        </div>
      </Sheet>
      <Toasts />
    </div>
  );
}
