import * as Menu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, Brain, CalendarClock, Check, Home, Inbox, LayoutGrid, ListChecks, LogOut, Monitor, Moon, MoreHorizontal, Pencil, Plus, Search, Settings, Shield, Sun, Trash2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { navigate, usePath } from '../lib/router';
import { useStore } from '../lib/store';
import { getTheme, resolvedTheme, setTheme, type Theme } from '../lib/theme';
import { CommandPalette } from './CommandPalette';
import { Logo } from './Logo';
import { IconButton, Kbd, Sheet, ShellContext, StatusDot } from './ui';

async function signOut() {
  await api.post('/auth/logout').catch(() => {});
  location.href = '/';
}

const menuItem = 'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-panel-2 data-[highlighted]:text-fg';
const menuContent = 'z-[80] min-w-44 rounded-lg border border-line bg-panel p-1 shadow-2';

function useTheme() {
  const [theme, set] = useState<Theme>(getTheme);
  useEffect(() => {
    const on = () => set(getTheme());
    window.addEventListener('sable:theme', on);
    return () => window.removeEventListener('sable:theme', on);
  }, []);
  return theme;
}

// ───────────────────────── Sidebar ─────────────────────────

function NavItem({ to, label, icon: Icon, count, active, onNavigate }: { to: string; label: string; icon: typeof Home; count?: number; active: boolean; onNavigate?: () => void }) {
  return (
    <button
      onClick={() => {
        navigate(to);
        onNavigate?.();
      }}
      className={cx('group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', active ? 'text-fg' : 'text-fg-2 hover:bg-panel-2/60 hover:text-fg')}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md border border-line bg-panel shadow-1" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />}
      <Icon className={cx('relative size-[15px]', active ? 'text-fg' : 'text-fg-3 group-hover:text-fg-2')} strokeWidth={1.8} />
      <span className="relative flex-1 text-left">{label}</span>
      {!!count && <span className="relative rounded bg-accent-soft px-1.5 font-mono text-[11px] font-medium text-accent tabular">{count}</span>}
    </button>
  );
}

function ChatRow({ id, title, active, running, waiting, onNavigate }: { id: string; title: string; active: boolean; running: boolean; waiting: boolean; onNavigate?: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(title);
  async function rename() {
    setRenaming(false);
    if (value.trim() && value !== title) await api.patch(`/conversations/${id}`, { title: value.trim() });
  }
  async function remove() {
    await api.del(`/conversations/${id}`);
    useStore.setState((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
    if (location.pathname === `/chat/${id}`) navigate('/');
  }
  if (renaming)
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void rename();
          if (e.key === 'Escape') setRenaming(false);
        }}
        className="h-7 w-full rounded-md border border-line-strong bg-panel px-2 text-[13px] outline-none"
      />
    );
  return (
    <div className="group relative">
      <button
        onClick={() => {
          navigate(`/chat/${id}`);
          onNavigate?.();
        }}
        className={cx('flex h-7 w-full items-center gap-2 rounded-md px-2 pr-7 text-left text-[13px] transition-colors', active ? 'bg-panel-2 text-fg' : 'text-fg-2 hover:bg-panel-2/60 hover:text-fg')}
      >
        {(running || waiting) && <StatusDot state={waiting ? 'waiting' : 'running'} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-fg-3 opacity-0 transition-opacity hover:bg-panel-3 hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Chat options">
            <MoreHorizontal className="size-3.5" />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} className={menuContent}>
            <Menu.Item className={menuItem} onSelect={() => (setValue(title), setRenaming(true))}>
              <Pencil className="size-3.5" /> Rename
            </Menu.Item>
            <Menu.Item className={cx(menuItem, 'data-[highlighted]:text-danger')} onSelect={() => void remove()}>
              <Trash2 className="size-3.5" /> Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function AccountMenu() {
  const theme = useTheme();
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-fg-2 outline-none hover:bg-panel-2/60 hover:text-fg data-[state=open]:bg-panel-2">
          <span className="flex size-[18px] items-center justify-center rounded-full bg-panel-3 text-[10px] font-semibold text-fg-2">Y</span>
          <span className="flex-1 text-left">You</span>
          <MoreHorizontal className="size-4 text-fg-3" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content side="top" align="start" sideOffset={6} className={cx(menuContent, 'w-56')}>
          <div className="px-2 py-1.5 text-xs text-fg-3">Signed in to {name}</div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-fg-3">Theme</Menu.Label>
          {(
            [
              ['system', 'System', Monitor],
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
            ] as const
          ).map(([value, label, Icon]) => (
            <Menu.Item key={value} className={menuItem} onSelect={() => setTheme(value)}>
              <Icon className="size-3.5" /> <span className="flex-1">{label}</span> {theme === value && <Check className="size-3.5 text-fg" />}
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item className={menuItem} onSelect={() => navigate('/settings')}>
            <Settings className="size-3.5" /> Settings
          </Menu.Item>
          <Menu.Item className={menuItem} onSelect={() => void signOut()}>
            <LogOut className="size-3.5" /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SidebarContent({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const path = usePath();
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  const conversations = useStore((s) => s.conversations);
  const runs = useStore((s) => s.runs);
  const approvals = useStore((s) => s.approvals);
  const unread = useStore((s) => s.unread);
  const waitingConvs = new Set(approvals.map((a) => a.conversation_id));
  const anyRunning = Object.keys(runs).length > 0;

  const agentNav = [
    { to: '/goals', label: 'Goals', icon: ListChecks },
    { to: '/routines', label: 'Routines', icon: CalendarClock },
    { to: '/spaces', label: 'Spaces', icon: LayoutGrid },
    { to: '/memory', label: 'Memory', icon: Brain },
    { to: '/activity', label: 'Activity', icon: Activity },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2.5 px-3">
        <Logo size={22} live={anyRunning} />
        <span className="flex-1 truncate text-[14px] font-semibold tracking-[-0.01em]">{name}</span>
        <IconButton
          label="New task"
          side="bottom"
          onClick={() => {
            navigate('/');
            onNavigate?.();
          }}
        >
          <Plus className="size-4" />
        </IconButton>
      </div>
      <div className="px-2">
        <button onClick={onSearch} className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-panel px-2 text-[13px] text-fg-3 shadow-1 transition-colors hover:border-line-strong hover:text-fg-2">
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      <nav className="mt-3 space-y-px px-2">
        <NavItem to="/" label="Home" icon={Home} active={path === '/'} onNavigate={onNavigate} />
        <NavItem to="/inbox" label="Inbox" icon={Inbox} count={approvals.length + unread} active={path === '/inbox'} onNavigate={onNavigate} />
      </nav>
      <div className="mt-5 px-4 pb-1 text-[11px] font-medium text-fg-3">Agent</div>
      <nav className="space-y-px px-2">
        {agentNav.map((n) => (
          <NavItem key={n.to} {...n} active={path.startsWith(n.to)} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="mt-5 flex items-center justify-between px-4 pb-1 text-[11px] font-medium text-fg-3">
        <span>Chats</span>
        <span className="font-mono tabular">{conversations.length || ''}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-2">
        {conversations.slice(0, 60).map((c) => (
          <ChatRow key={c.id} id={c.id} title={c.title} active={path === `/chat/${c.id}`} running={!!runs[c.id]} waiting={waitingConvs.has(c.id)} onNavigate={onNavigate} />
        ))}
        {!conversations.length && <p className="px-2 py-2 text-xs text-fg-3">No chats yet.</p>}
      </div>
      <div className="space-y-px border-t border-line p-2">
        <NavItem to="/settings" label="Settings" icon={Settings} active={path.startsWith('/settings')} onNavigate={onNavigate} />
        <AccountMenu />
      </div>
    </div>
  );
}

// ───────────────────────── Status bar ─────────────────────────

function StatusBar() {
  const connected = useStore((s) => s.connected);
  const settings = useStore((s) => s.settings);
  const runs = useStore((s) => Object.keys(s.runs).length);
  const approvals = useStore((s) => s.approvals.length);
  const [proxy, setProxy] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void api.get<{ proxy: string | null }>('/network').then((r) => setProxy(r.proxy)).catch(() => {});
  }, []);
  const provider = settings?.providers.find((p) => p.id === settings.main.providerId);
  return (
    <div className="hidden h-7 shrink-0 items-center gap-4 border-t border-line bg-sunken px-4 font-mono text-[11px] text-fg-3 md:flex">
      <span className="flex items-center gap-1.5">
        <StatusDot state={connected ? 'ok' : 'waiting'} className="scale-75" />
        {connected ? 'connected' : 'reconnecting'}
      </span>
      <button onClick={() => navigate('/settings/models')} className="hover:text-fg-2">
        {settings?.main.model || 'auto'} · {provider?.name.toLowerCase()}
      </button>
      {proxy !== undefined && (
        <span className="flex items-center gap-1.5" title={proxy ?? 'Agent web traffic uses the server network directly'}>
          <Shield className={cx('size-3', proxy ? 'text-ok' : '')} />
          egress {proxy ? 'via vpn proxy' : 'direct'}
        </span>
      )}
      <span className="flex-1" />
      {runs > 0 && (
        <span className="flex items-center gap-1.5">
          <StatusDot state="running" className="scale-75" /> {runs} running
        </span>
      )}
      {approvals > 0 && (
        <button onClick={() => navigate('/inbox')} className="flex items-center gap-1.5 text-accent hover:underline">
          <StatusDot state="waiting" className="scale-75" /> {approvals} awaiting approval
        </button>
      )}
    </div>
  );
}

// ───────────────────────── Mobile ─────────────────────────

function MobileTabs({ onMore }: { onMore: () => void }) {
  const path = usePath();
  const approvals = useStore((s) => s.approvals.length);
  const unread = useStore((s) => s.unread);
  const tabs = [
    { to: '/', label: 'Home', icon: Home, active: path === '/' || path.startsWith('/chat') },
    { to: '/goals', label: 'Goals', icon: ListChecks, active: path.startsWith('/goals') },
    { to: '/spaces', label: 'Spaces', icon: LayoutGrid, active: path.startsWith('/spaces') },
    { to: '/inbox', label: 'Inbox', icon: Inbox, active: path === '/inbox', count: approvals + unread },
  ];
  const moreActive = ['/routines', '/memory', '/activity', '/settings'].some((p) => path.startsWith(p));
  return (
    <nav className="pb-safe z-30 shrink-0 border-t border-line bg-bg/90 backdrop-blur-md md:hidden">
      <div className="grid h-14 grid-cols-5">
        {tabs.map((t) => (
          <button key={t.to} onClick={() => navigate(t.to)} className={cx('relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium', t.active ? 'text-fg' : 'text-fg-3')}>
            <span className="relative">
              <t.icon className="size-[19px]" strokeWidth={t.active ? 2.1 : 1.7} />
              {!!t.count && <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[9.5px] font-semibold leading-4 text-bg">{t.count}</span>}
            </span>
            {t.label}
          </button>
        ))}
        <button onClick={onMore} className={cx('flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium', moreActive ? 'text-fg' : 'text-fg-3')}>
          <MoreHorizontal className="size-[19px]" />
          More
        </button>
      </div>
    </nav>
  );
}

// ───────────────────────── Shell ─────────────────────────

export function Shell({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const [palette, setPalette] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ShellContext.Provider value={{ openNav: () => setDrawer(true), openPalette: () => setPalette(true) }}>
      <div className="flex h-dvh overflow-hidden bg-bg">
        <aside className="hidden w-[244px] shrink-0 border-r border-line bg-sunken md:block">
          <SidebarContent onSearch={() => setPalette(true)} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={routeKey} className="absolute inset-0 flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
          <StatusBar />
          <MobileTabs onMore={() => setMore(true)} />
        </div>

        <AnimatePresence>
          {drawer && (
            <div className="fixed inset-0 z-50 md:hidden">
              <motion.div className="absolute inset-0 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 500, damping: 48 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.4, right: 0 }}
                onDragEnd={(_, info) => info.offset.x < -70 && setDrawer(false)}
                className="pt-safe pb-safe absolute inset-y-0 left-0 w-[82%] max-w-[300px] border-r border-line bg-sunken"
              >
                <SidebarContent onNavigate={() => setDrawer(false)} onSearch={() => (setDrawer(false), setPalette(true))} />
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <Sheet open={more} onClose={() => setMore(false)} title="More">
          <div className="-m-2 space-y-px">
            {[
              { to: '/routines', label: 'Routines', icon: CalendarClock },
              { to: '/memory', label: 'Memory', icon: Brain },
              { to: '/activity', label: 'Activity', icon: Activity },
              { to: '/settings', label: 'Settings', icon: Settings },
            ].map((n) => (
              <button key={n.to} onClick={() => (setMore(false), navigate(n.to))} className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-[14px] hover:bg-panel-2">
                <n.icon className="size-4 text-fg-3" /> {n.label}
              </button>
            ))}
            <button onClick={() => void signOut()} className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-[14px] text-danger hover:bg-panel-2">
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </Sheet>
        <CommandPalette open={palette} onClose={() => setPalette(false)} onSignOut={() => void signOut()} />
        <Toaster theme={theme === 'system' ? resolvedTheme() : theme} position="bottom-right" offset={44} toastOptions={{ classNames: { toast: '!bg-panel !border-line !text-fg !shadow-2 !rounded-lg !font-sans', description: '!text-fg-2', actionButton: '!bg-fg !text-bg' } }} />
      </div>
    </ShellContext.Provider>
  );
}
