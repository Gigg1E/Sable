import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, BellRing, CalendarClock, Download, ExternalLink, Eye, FolderOpen, LayoutGrid, Maximize2, Minimize2, Pin, PinOff, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { usePanel, type PanelTab } from '../lib/panel';
import { navigate } from '../lib/router';
import { onServerEvent } from '../lib/store';
import type { FileCardData, Message, Schedule, SpaceSummary, Watcher } from '../lib/types';
import { SpaceFrame, useSpace } from '../views/Spaces';
import { FileGlyph, fmtBytes } from './Cards';
import { Markdown } from './Markdown';
import { CopyButton, Spinner, Tip } from './ui';

type ChatFile = FileCardData & { view: string };

const fileUrl = (p: string, download?: boolean, v?: number) => `/api/files/raw?path=${encodeURIComponent(p)}${download ? '&download=1' : ''}${v ? `&v=${Math.round(v)}` : ''}`;

/** Spaces this chat created or changed, newest last. */
function spacesIn(messages: Message[]): string[] {
  const ids: string[] = [];
  const add = (id?: unknown) => typeof id === 'string' && id && !ids.includes(id) && ids.push(id);
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_name === 'space_create') add(/Space (\S+) created/.exec(m.content)?.[1]);
    for (const c of m.tool_calls ?? []) if (c.name === 'space_update') add((c.args as { id?: string }).id);
  }
  return ids;
}

/** Open the panel by itself when the agent makes something in this chat. */
export function usePanelAutoOpen(conversationId: string) {
  useEffect(
    () =>
      onServerEvent((ev) => {
        const p = usePanel.getState();
        if (!p.auto) return;
        if (ev.type === 'workspace.file' && String(ev.path).startsWith(`chats/${conversationId}/outputs/`)) p.show('files', String(ev.path));
        else if (ev.type === 'space.changed' && !ev.deleted && ev.conversationId === conversationId) p.show(`space:${ev.id}`);
        else if ((ev.type === 'schedule.changed' || ev.type === 'watcher.changed') && ev.conversationId === conversationId) p.show('reminders');
      }),
    [conversationId],
  );
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} className={cx('relative flex h-9 shrink-0 items-center gap-1.5 px-2.5 text-[12.5px] transition-colors', active ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}>
      {icon}
      <span className="max-w-[140px] truncate">{label}</span>
      {!!count && <span className="rounded bg-panel-3 px-1 font-mono text-[10.5px] text-fg-2">{count}</span>}
      {active && <motion.span layoutId="panel-tab" className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-tint" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />}
    </button>
  );
}

// ───────────── Files ─────────────

function FileViewer({ path, chat, onBack }: { path: string; chat: string; onBack: () => void }) {
  const [meta, setMeta] = useState<(FileCardData & { text?: string; truncated?: boolean }) | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/files/meta?path=${encodeURIComponent(path)}&chat=${encodeURIComponent(chat)}`, { credentials: 'same-origin' });
    if (!r.ok) return setMissing(true);
    setMissing(false);
    setMeta(await r.json());
  }, [path, chat]);
  useEffect(() => {
    void load();
    return onServerEvent((ev) => ev.type === 'workspace.file' && ev.path === path && void load());
  }, [path, load]);
  const isMd = !!meta && /\.(md|markdown)$/i.test(meta.name);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <Tip label="All files">
          <button onClick={onBack} className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg" aria-label="All files">
            <ArrowLeft className="size-4" />
          </button>
        </Tip>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{meta?.name ?? path.split('/').pop()}</span>
        {meta?.text !== undefined && <CopyButton text={() => meta?.text ?? ''} label="Copy contents" />}
        {meta && (
          <a href={fileUrl(meta.path, true)} download={meta.name} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-fg-2 hover:border-line-strong hover:text-fg">
            <Download className="size-3.5" /> Download
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-sunken">
        {missing ? (
          <p className="p-6 text-center text-[13px] text-fg-3">This file no longer exists.</p>
        ) : !meta ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : meta.kind === 'image' ? (
          <img src={fileUrl(meta.path, false, meta.updated)} alt={meta.name} className="mx-auto block max-w-full p-4" />
        ) : meta.text !== undefined ? (
          isMd ? (
            <Markdown text={meta.text} className="mx-auto max-w-[760px] px-6 py-5" />
          ) : (
            <pre className="whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-[1.6] text-fg-2">{meta.text}</pre>
          )
        ) : (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <FileGlyph name={meta.name} className="size-12" />
            <p className="text-[13px] text-fg-3">No preview for this kind of file.</p>
            <a href={fileUrl(meta.path, true)} download={meta.name} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-[13px] text-bg">
              <Download className="size-3.5" /> Download {fmtBytes(meta.size)}
            </a>
          </div>
        )}
        {meta?.truncated && <p className="px-5 pb-4 text-[11.5px] text-fg-3">Preview cut off: download for the full file.</p>}
      </div>
    </div>
  );
}

function FilesTab({ chat, files }: { chat: string; files: ChatFile[] }) {
  const file = usePanel((s) => s.file);
  const set = usePanel((s) => s.set);
  if (file) return <FileViewer path={file} chat={chat} onBack={() => set({ file: null })} />;
  const groups: [string, ChatFile[]][] = [
    ['Outputs', files.filter((f) => f.view.startsWith('outputs/'))],
    ['Your uploads', files.filter((f) => f.view.startsWith('uploads/'))],
    ['Working files', files.filter((f) => !f.view.startsWith('outputs/') && !f.view.startsWith('uploads/'))],
  ];
  if (!files.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <FolderOpen className="size-6 text-fg-3" />
        <p className="text-[13px] text-fg-2">No files in this chat yet.</p>
        <p className="max-w-[260px] text-[12px] leading-relaxed text-fg-3">Files you attach and anything the agent saves for you show up here, ready to read or download.</p>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {groups.map(([label, list]) =>
        list.length ? (
          <div key={label} className="mb-3">
            <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-3">{label}</div>
            {list.map((f) => (
              <div key={f.path} className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-panel-2">
                <button onClick={() => set({ file: f.path })} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <FileGlyph name={f.name} className="size-8" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{f.view.split('/').slice(1).join('/') || f.name}</span>
                    <span className="block font-mono text-[11px] text-fg-3">
                      {fmtBytes(f.size)} · {new Date(f.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </span>
                </button>
                <Tip label="Open">
                  <button onClick={() => set({ file: f.path })} className="flex size-7 items-center justify-center rounded-md text-fg-3 opacity-0 hover:bg-panel-3 hover:text-fg group-hover:opacity-100" aria-label={`Open ${f.name}`}>
                    <Eye className="size-3.5" />
                  </button>
                </Tip>
                <Tip label="Download">
                  <a href={fileUrl(f.path, true)} download={f.name} className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-3 hover:text-fg" aria-label={`Download ${f.name}`}>
                    <Download className="size-3.5" />
                  </a>
                </Tip>
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

// ───────────── Reminders ─────────────

function when(t: number | null) {
  if (!t) return 'not scheduled';
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString(undefined, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function RemindersTab({ schedules, watchers }: { schedules: Schedule[]; watchers: Watcher[] }) {
  const upcoming = schedules.filter((s) => s.enabled).sort((a, b) => (a.next_run ?? Infinity) - (b.next_run ?? Infinity));
  const paused = schedules.filter((s) => !s.enabled);
  const kind = (s: Schedule) => (s.kind === 'once' ? 'once' : s.kind === 'interval' ? `every ${s.spec.every_minutes} min` : s.kind === 'daily' ? `daily ${s.spec.time ?? ''}` : 'weekly');
  if (!schedules.length && !watchers.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <BellRing className="size-6 text-fg-3" />
        <p className="text-[13px] text-fg-2">No reminders or watchers yet.</p>
        <p className="max-w-[260px] text-[12px] leading-relaxed text-fg-3">Try "remind me Friday at 5 to call the bank" or "tell me when this drops below $100".</p>
      </div>
    );
  const Row = ({ title, sub, right, dot, to }: { title: string; sub: string; right?: string; dot: string; to: string }) => (
    <button onClick={() => navigate(to)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-panel-2">
      <span className={cx('size-1.5 shrink-0 rounded-full', dot)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title}</span>
        <span className="block truncate text-[11.5px] text-fg-3">{sub}</span>
      </span>
      {right && <span className="shrink-0 font-mono text-[11px] text-fg-2">{right}</span>}
    </button>
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {upcoming.length > 0 && <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-3">Coming up</div>}
      {upcoming.map((s) => (
        <Row key={s.id} title={s.title} sub={kind(s)} right={when(s.next_run)} dot="bg-tint" to="/routines" />
      ))}
      {watchers.length > 0 && <div className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-fg-3">Watching</div>}
      {watchers.map((w) => (
        <Row key={w.id} title={w.title} sub={w.conditionLabel} right={w.last_value ?? undefined} dot={w.enabled ? 'bg-ok' : 'bg-fg-3'} to="/watchers" />
      ))}
      {paused.length > 0 && <div className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-fg-3">Paused</div>}
      {paused.map((s) => (
        <Row key={s.id} title={s.title} sub={kind(s)} dot="bg-fg-3" to="/routines" />
      ))}
    </div>
  );
}

// ───────────── Spaces ─────────────

function SpaceTab({ id, onGone }: { id: string; onGone: () => void }) {
  const { space, load } = useSpace(id, onGone);
  const [nonce, setNonce] = useState(0);
  if (!space)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium">{space.title}</span>
        <Tip label="Reload">
          <button onClick={() => setNonce((n) => n + 1)} className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg" aria-label="Reload">
            <RotateCw className="size-3.5" />
          </button>
        </Tip>
        <Tip label={space.pinned ? 'Unpin: only show in chats that use it' : 'Pin: keep this tab in every chat'}>
          <button onClick={() => void api.patch(`/spaces/${id}`, { pinned: !space.pinned }).then(load)} className={cx('flex size-7 items-center justify-center rounded-md hover:bg-panel-2', space.pinned ? 'text-tint' : 'text-fg-3 hover:text-fg')} aria-label={space.pinned ? 'Unpin' : 'Pin'}>
            {space.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        </Tip>
        <Tip label="Open as a page">
          <button onClick={() => navigate(`/spaces/${id}`)} className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg" aria-label="Open as a page">
            <ExternalLink className="size-3.5" />
          </button>
        </Tip>
      </div>
      <SpaceFrame space={space} nonce={nonce} />
    </div>
  );
}

// ───────────── Panel ─────────────

export function SidePanel({ conversationId, messages }: { conversationId: string; messages: Message[] }) {
  const { open, tab, width, full, auto, set, show } = usePanel();
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const loadFiles = useCallback(() => void api.get<ChatFile[]>(`/conversations/${conversationId}/files`).then(setFiles).catch(() => setFiles([])), [conversationId]);
  const loadReminders = useCallback(() => {
    void api.get<Schedule[]>('/schedules').then(setSchedules);
    void api.get<Watcher[]>('/watchers').then(setWatchers);
  }, []);
  const loadSpaces = useCallback(() => void api.get<SpaceSummary[]>('/spaces').then(setSpaces), []);
  useEffect(() => {
    loadFiles();
    loadReminders();
    loadSpaces();
    return onServerEvent((ev) => {
      if (ev.type === 'workspace.file' && String(ev.path).startsWith(`chats/${conversationId}/`)) loadFiles();
      if (ev.type === 'schedule.changed' || ev.type === 'watcher.changed') loadReminders();
      if (ev.type === 'space.changed') loadSpaces();
    });
  }, [conversationId, loadFiles, loadReminders, loadSpaces]);
  useEffect(() => {
    if (open && tab === 'files') loadFiles();
  }, [open, tab, loadFiles, messages.length]);

  // Tabs: files, reminders, the spaces this chat made, and pinned spaces.
  const chatSpaces = useMemo(() => spacesIn(messages), [messages]);
  const spaceTabs = useMemo(() => {
    const known = new Map(spaces.map((s) => [s.id, s]));
    const ids = [...chatSpaces, ...spaces.filter((s) => s.pinned).map((s) => s.id)];
    return [...new Set(ids)].filter((id) => known.has(id)).map((id) => known.get(id)!);
  }, [chatSpaces, spaces]);
  const activeSpace = tab.startsWith('space:') ? tab.slice(6) : null;
  const effectiveTab: PanelTab = activeSpace && !spaceTabs.some((s) => s.id === activeSpace) && spaces.length ? 'files' : tab;

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ full: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, set]);

  function startResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const max = Math.max(360, (box.current?.parentElement?.clientWidth ?? 1200) - 480);
    const move = (ev: PointerEvent) => set({ width: Math.min(max, Math.max(320, startW + (startX - ev.clientX))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const upcoming = schedules.filter((s) => s.enabled).length + watchers.filter((w) => w.enabled).length;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          ref={box}
          key="panel"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ '--panel-w': `${width}px` } as React.CSSProperties}
          className={cx(
            'flex min-h-0 flex-col border-line bg-panel',
            full ? 'absolute inset-0 z-30' : 'pt-safe fixed inset-0 z-40 md:relative md:inset-auto md:z-auto md:w-[var(--panel-w)] md:shrink-0 md:border-l md:pt-0',
          )}
        >
          {!full && <div onPointerDown={startResize} className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize md:block" aria-hidden />}
          <div className="flex shrink-0 items-center border-b border-line pr-1.5">
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]">
              <TabButton active={effectiveTab === 'files'} onClick={() => show('files')} icon={<FolderOpen className="size-3.5" />} label="Files" count={files.length} />
              <TabButton active={effectiveTab === 'reminders'} onClick={() => show('reminders')} icon={<CalendarClock className="size-3.5" />} label="Reminders" count={upcoming} />
              {spaceTabs.map((s) => (
                <TabButton key={s.id} active={effectiveTab === `space:${s.id}`} onClick={() => show(`space:${s.id}`)} icon={s.pinned ? <Pin className="size-3 text-tint" /> : <LayoutGrid className="size-3.5" />} label={s.title} />
              ))}
            </div>
            <Tip label={full ? 'Exit full screen (Esc)' : 'Full screen'}>
              <button onClick={() => set({ full: !full })} className="hidden size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg md:flex" aria-label="Full screen">
                {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
            </Tip>
            <Tip label="Close panel">
              <button onClick={() => set({ open: false, full: false })} className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg" aria-label="Close panel">
                <X className="size-4" />
              </button>
            </Tip>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {effectiveTab === 'files' && <FilesTab chat={conversationId} files={files} />}
            {effectiveTab === 'reminders' && <RemindersTab schedules={schedules} watchers={watchers} />}
            {activeSpace && effectiveTab !== 'files' && <SpaceTab key={activeSpace} id={activeSpace} onGone={() => show('files')} />}
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 border-t border-line px-3 py-1.5 text-[11.5px] text-fg-3">
            <input type="checkbox" checked={auto} onChange={(e) => set({ auto: e.target.checked })} className="accent-[var(--tint)]" />
            Open this panel when the agent makes a file, space or reminder
          </label>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
