import * as Menu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, Brain, CalendarClock, Library, Check, Home, Inbox, LayoutGrid, ListChecks, MessagesSquare, LogOut, Monitor, Moon, ChevronRight, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff, Plus, Radar, Search, Settings, Shield, Sun, Trash2, Volume2, VolumeX, Webhook,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { api } from '../lib/api';
import { dur, ease } from '../lib/motion';
import { FreezeButton, FrozenBanner } from './Safety';
import { cx } from '../lib/format';
import { navigate, usePath } from '../lib/router';
import { useStore } from '../lib/store';
import { usePanel } from '../lib/panel';
import { play, setSoundPrefs, soundPrefs } from '../lib/sounds';
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
      className={cx('group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', active ? 'text-fg' : 'text-fg-2 hover:bg-side-active/70 hover:text-fg')}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md border border-side-line bg-side-active shadow-1 before:absolute before:inset-y-1.5 before:-left-[9px] before:w-[3px] before:rounded-full before:bg-tint" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />}
      <Icon className={cx('relative size-[15px]', active ? 'text-tint' : 'text-fg-3 group-hover:text-fg-2')} strokeWidth={1.8} />
      <span className="relative flex-1 text-left">{label}</span>
      {!!count && <span className="relative rounded bg-accent-soft px-1.5 font-mono text-[11px] font-medium text-accent tabular">{count}</span>}
    </button>
  );
}

const AUTOMATION_KINDS: Record<string, { icon: typeof CalendarClock; label: string }> = {
  schedule: { icon: CalendarClock, label: 'Routine' },
  watch: { icon: Radar, label: 'Watcher' },
  hook: { icon: Webhook, label: 'Webhook' },
};
/** Automation chats were titled "⏰ Morning weather"; the icon now says what they are. */
const cleanTitle = (t: string) => t.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '') || t;

function ChatRow({ id, title, kind, pinned, active, running, waiting, onNavigate }: { id: string; title: string; kind: string; pinned: boolean; active: boolean; running: boolean; waiting: boolean; onNavigate?: () => void }) {
  const auto = AUTOMATION_KINDS[kind];
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
        {running || waiting ? <StatusDot state={waiting ? 'waiting' : 'running'} /> : auto ? <auto.icon className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.8} /> : null}
        <span className="min-w-0 flex-1 truncate">{cleanTitle(title)}</span>
      </button>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-fg-3 opacity-0 transition-opacity hover:bg-panel-3 hover:text-fg group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100" aria-label="Chat options">
            <MoreHorizontal className="size-3.5" />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} className={menuContent}>
            <Menu.Item
              className={menuItem}
              onSelect={() => {
                useStore.setState((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, pinned: !pinned } : c)) }));
                void api.patch(`/conversations/${id}`, { pinned: !pinned });
              }}
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />} {pinned ? 'Unpin' : 'Pin to top'}
            </Menu.Item>
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
  const [soundsOn, setSoundsOn] = useState(() => soundPrefs().on);
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
          <Menu.Item
            className={menuItem}
            onSelect={(e) => {
              e.preventDefault();
              const on = !soundPrefs().on;
              setSoundPrefs({ on });
              setSoundsOn(on);
              if (on) play('toggle');
            }}
          >
            {soundsOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />} <span className="flex-1">Sounds</span>
            <span className="text-[11px] text-fg-3">{soundsOn ? 'On' : 'Off'}</span>
          </Menu.Item>
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

function SectionHead({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-medium text-fg-3">
      <span>{label}</span>
      {!!count && <span className="font-mono tabular">{count}</span>}
    </div>
  );
}

function SidebarContent({ onNavigate, onSearch, onCollapse }: { onNavigate?: () => void; onSearch: () => void; onCollapse?: () => void }) {
  const path = usePath();
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  const [autoOpen, setAutoOpenState] = useState(() => {
    try {
      return localStorage.getItem('sable.autosOpen') !== '0';
    } catch {
      return true;
    }
  });
  const setAutoOpen = (f: (o: boolean) => boolean) =>
    setAutoOpenState((o) => {
      const n = f(o);
      try {
        localStorage.setItem('sable.autosOpen', n ? '1' : '0');
      } catch {
        /* ignore */
      }
      return n;
    });
  const conversations = useStore((s) => s.conversations);
  const runs = useStore((s) => s.runs);
  const approvals = useStore((s) => s.approvals);
  const unread = useStore((s) => s.unread);
  const waitingConvs = new Set(approvals.map((a) => a.conversation_id));
  const anyRunning = Object.keys(runs).length > 0;

  const agentNav = [
    { to: '/goals', label: 'Goals', icon: ListChecks },
    { to: '/routines', label: 'Routines', icon: CalendarClock },
    { to: '/watchers', label: 'Watchers', icon: Radar },
    { to: '/webhooks', label: 'Webhooks', icon: Webhook },
    { to: '/spaces', label: 'Spaces', icon: LayoutGrid },
    { to: '/library', label: 'Library', icon: Library },
    { to: '/memory', label: 'Memory', icon: Brain },
    { to: '/activity', label: 'Activity', icon: Activity },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2.5 px-3">
        <Logo size={22} live={anyRunning} target />
        <span className="flex-1 truncate text-[14px] font-semibold tracking-[-0.01em]">{name}</span>
        {onCollapse && (
          <IconButton label="Hide sidebar" kbd="Ctrl \\" side="bottom" onClick={onCollapse}>
            <PanelLeftClose className="size-4" />
          </IconButton>
        )}
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
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {(() => {
          const row = (c: (typeof conversations)[number]) => (
            <ChatRow key={c.id} id={c.id} title={c.title} kind={c.kind} pinned={!!c.pinned} active={path === `/chat/${c.id}`} running={!!runs[c.id]} waiting={waitingConvs.has(c.id)} onNavigate={onNavigate} />
          );
          const pinnedList = conversations.filter((c) => c.pinned);
          const chats = conversations.filter((c) => !c.pinned && !AUTOMATION_KINDS[c.kind]);
          const autos = conversations.filter((c) => !c.pinned && AUTOMATION_KINDS[c.kind]);
          const autoBusy = autos.some((c) => runs[c.id] || waitingConvs.has(c.id));
          return (
            <>
              {pinnedList.length > 0 && (
                <>
                  <SectionHead label="Pinned" />
                  <div className="mb-3 space-y-px">{pinnedList.map(row)}</div>
                </>
              )}
              <SectionHead label="Chats" count={chats.length} />
              <div className="space-y-px">{chats.slice(0, 60).map(row)}</div>
              {!chats.length && <p className="px-2 py-2 text-xs text-fg-3">No chats yet.</p>}
              {autos.length > 0 && (
                <div className="mt-3">
                  <button onClick={() => setAutoOpen((o) => !o)} className="flex w-full items-center gap-1 rounded-md px-2 pb-1 pt-1 text-[11px] font-medium text-fg-3 hover:text-fg-2">
                    <ChevronRight className={cx('size-3 transition-transform', autoOpen && 'rotate-90')} />
                    <span className="flex-1 text-left">Automations</span>
                    {autoBusy && <StatusDot state="running" />}
                    <span className="font-mono tabular">{autos.length}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {autoOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="space-y-px overflow-hidden">
                        {autos.slice(0, 40).map(row)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          );
        })()}
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
    <div className="hidden h-7 shrink-0 items-center gap-4 border-t border-side-line bg-side px-4 text-[11.5px] tabular-nums text-fg-3 md:flex">
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
      <FreezeButton />
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

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, select, [contenteditable="true"]';

/**
 * On touch devices: report whether the on-screen keyboard is (probably) open, and pin the app to
 * the visual viewport so the layout sits above the keyboard instead of being scrolled behind it.
 */
function useTouchKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const isField = (el: Element | null) => !!el && el instanceof HTMLElement && el.matches(FIELD) && !(el as HTMLInputElement).readOnly;
    const onIn = (e: FocusEvent) => isField(e.target as Element) && setOpen(true);
    const onOut = () => setTimeout(() => setOpen(isField(document.activeElement)), 60);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);

    const vv = window.visualViewport;
    const root = document.documentElement;
    const sync = () => {
      if (!vv) return;
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
    };
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    sync();
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
    };
  }, []);
  return open;
}

function MobileTabs({ onMore, onChats, hidden }: { onMore: () => void; onChats: () => void; hidden: boolean }) {
  const path = usePath();
  const approvals = useStore((s) => s.approvals.length);
  const unread = useStore((s) => s.unread);
  const tabs = [
    { to: '/', label: 'Home', icon: Home, active: path === '/' },
    { to: '#chats', label: 'Chats', icon: MessagesSquare, active: path.startsWith('/chat') },
    { to: '/spaces', label: 'Spaces', icon: LayoutGrid, active: path.startsWith('/spaces') },
    { to: '/inbox', label: 'Inbox', icon: Inbox, active: path === '/inbox', count: approvals + unread },
  ];
  const moreActive = ['/goals', '/routines', '/watchers', '/webhooks', '/memory', '/activity', '/settings'].some((p) => path.startsWith(p));
  return (
    <AnimatePresence initial={false}>
      {!hidden && (
    <motion.nav
      key="tabs"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="pb-safe z-30 shrink-0 overflow-hidden border-t border-line bg-bg/90 backdrop-blur-md md:hidden"
    >
      <div className="grid h-14 grid-cols-5">
        {tabs.map((t) => (
          <button key={t.to} onClick={() => (t.to === '#chats' ? onChats() : navigate(t.to))} className={cx('relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium', t.active ? 'text-fg' : 'text-fg-3')}>
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
    </motion.nav>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────── Shell ─────────────────────────

export function Shell({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const path = usePath();
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const [palette, setPalette] = useState(false);
  const theme = useTheme();
  const keyboard = useTouchKeyboard();

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

  const navCollapsed = usePanel((s) => s.navCollapsed);
  const setPanel = usePanel((s) => s.set);
  const toggleNav = () => setPanel({ navCollapsed: !usePanel.getState().navCollapsed });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setPanel({ navCollapsed: !usePanel.getState().navCollapsed });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPanel]);

  return (
    <ShellContext.Provider value={{ openNav: () => setDrawer(true), openPalette: () => setPalette(true), navCollapsed, toggleNav }}>
      <div className="fixed inset-x-0 flex overflow-hidden bg-bg" style={{ top: 'var(--app-top, 0px)', height: 'var(--app-h, 100dvh)' }}>
        <motion.aside
          initial={false}
          animate={{ width: navCollapsed ? 0 : 244, borderRightWidth: navCollapsed ? 0 : 1 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="hidden shrink-0 overflow-hidden border-side-line bg-side md:block"
        >
          <div className="h-full w-[244px]">
            <SidebarContent onSearch={() => setPalette(true)} onCollapse={toggleNav} />
          </div>
        </motion.aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <FrozenBanner />
          <main className="relative min-h-0 flex-1">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={routeKey}
                className="absolute inset-0 flex flex-col"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.out } }}
                exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.in } }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
          <StatusBar />
          <MobileTabs onMore={() => setMore(true)} onChats={() => setDrawer(true)} hidden={keyboard || /^\/(chat|spaces)\/./.test(path)} />
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
                className="pt-safe pb-safe absolute inset-y-0 left-0 w-[82%] max-w-[300px] border-r border-side-line bg-side"
              >
                <SidebarContent onNavigate={() => setDrawer(false)} onSearch={() => (setDrawer(false), setPalette(true))} />
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <Sheet open={more} onClose={() => setMore(false)} title="More">
          <div className="-m-2 space-y-px">
            {[
              { to: '/goals', label: 'Goals', icon: ListChecks },
              { to: '/routines', label: 'Routines', icon: CalendarClock },
              { to: '/watchers', label: 'Watchers', icon: Radar },
              { to: '/webhooks', label: 'Webhooks', icon: Webhook },
              { to: '/library', label: 'Library', icon: Library },
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
