import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Brain, Library, Users, AtSign, CalendarClock, Home, Inbox, LayoutGrid, ListChecks, LogOut, MessageSquare, Moon, Plus, Radar, Search, Settings, Sun, SunMoon, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { setTheme } from '../lib/theme';
import { Kbd } from './ui';

export function CommandPalette({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  const conversations = useStore((s) => s.conversations);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const pages = [
    { label: 'Home', to: '/', icon: Home },
    { label: 'Inbox', to: '/inbox', icon: Inbox },
    { label: 'Goals', to: '/goals', icon: ListChecks },
    { label: 'Routines', to: '/routines', icon: CalendarClock },
    { label: 'Watchers', to: '/watchers', icon: Radar },
    { label: 'Webhooks', to: '/webhooks', icon: Webhook },
    { label: 'Spaces', to: '/spaces', icon: LayoutGrid },
    { label: 'Mail', to: '/mail', icon: AtSign },
    { label: 'Library', to: '/library', icon: Library },
    { label: 'People', to: '/people', icon: Users },
    { label: 'Memory', to: '/memory', icon: Brain },
    { label: 'Activity', to: '/activity', icon: Activity },
  ];
  const settings = [
    ['General', 'general'],
    ['Security', 'security'],
    ['Models', 'models'],
    ['Sub-agents', 'agents'],
    ['Permissions', 'permissions'],
    ['Connectors', 'connectors'],
    ['Shopping', 'shopping'],
    ['Network', 'network'],
    ['Notifications', 'notifications'],
  ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[10vh] md:pt-[16vh]">
          <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.98, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.14 }} className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-panel shadow-2">
            <Command label="Command menu" loop onKeyDown={(e) => e.key === 'Escape' && onClose()}>
              <div className="flex items-center gap-2.5 border-b border-line px-4">
                <Search className="size-4 text-fg-3" />
                <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search chats, pages, settings…" className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-3" />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
                <Command.Empty>No results.</Command.Empty>
                <Command.Group heading="Actions">
                  <Command.Item onSelect={go(() => navigate('/'))}>
                    <Plus className="size-4" /> New task
                  </Command.Item>
                </Command.Group>
                {conversations.length > 0 && (
                  <Command.Group heading="Chats">
                    {conversations.slice(0, q ? 50 : 6).map((c) => (
                      <Command.Item key={c.id} value={`chat ${c.title} ${c.id}`} onSelect={go(() => navigate(`/chat/${c.id}`))}>
                        <MessageSquare className="size-4" /> <span className="truncate">{c.title}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group heading="Go to">
                  {pages.map((p) => (
                    <Command.Item key={p.to} value={`go ${p.label}`} onSelect={go(() => navigate(p.to))}>
                      <p.icon className="size-4" /> {p.label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Settings">
                  {settings.map(([label, id]) => (
                    <Command.Item key={id} value={`settings ${label}`} onSelect={go(() => navigate(`/settings/${id}`))}>
                      <Settings className="size-4" /> {label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Appearance">
                  <Command.Item value="theme light" onSelect={go(() => setTheme('light'))}>
                    <Sun className="size-4" /> Light theme
                  </Command.Item>
                  <Command.Item value="theme dark" onSelect={go(() => setTheme('dark'))}>
                    <Moon className="size-4" /> Dark theme
                  </Command.Item>
                  <Command.Item value="theme system" onSelect={go(() => setTheme('system'))}>
                    <SunMoon className="size-4" /> System theme
                  </Command.Item>
                </Command.Group>
                <Command.Group heading="Account">
                  <Command.Item value="sign out log out" onSelect={go(onSignOut)}>
                    <LogOut className="size-4" /> Sign out
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
