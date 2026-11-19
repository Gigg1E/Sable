import { AnimatePresence, motion } from 'motion/react';
import { LayoutGrid, MessageSquare, Pin, PinOff, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, IconButton, Page, PageIntro, Spinner, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { resolvedTheme } from '../lib/theme';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Space, SpaceSummary } from '../lib/types';
import { startChat } from './Chat';

export function SpacesList() {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const load = useCallback(() => void api.get<SpaceSummary[]>('/spaces').then(setSpaces), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'space.changed' && load());
  }, [load]);

  return (
    <>
      <TopBar
        title="Spaces"
        actions={
          <Button size="sm" variant="primary" onClick={() => void startChat('Build me a space: ')}>
            <Plus className="size-3.5" /> New space
          </Button>
        }
      />
      <Page width="xl">
        <PageIntro title="Spaces" description="Small apps the agent builds for you: trackers, dashboards, planners. Each one keeps its own data and runs sandboxed, with no network access." />
        {spaces && !spaces.length ? (
          <Empty
            icon={<LayoutGrid className="size-4" />}
            title="No spaces yet"
            body="Describe what you want and the agent builds it."
            action={
              <Button size="sm" onClick={() => void startChat('Build me a space: a reading list where I can add books, mark them read, and see how many I finished this year.')}>
                Build a reading list
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {spaces?.map((s, i) => (
                <motion.button
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.025, duration: 0.2 } }}
                  exit={{ opacity: 0 }}
                  onClick={() => navigate(`/spaces/${s.id}`)}
                  className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel text-left shadow-1 transition-[border,transform,box-shadow] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-2"
                >
                  <div className="relative flex h-24 items-center justify-center border-b border-line bg-panel-2/60">
                    <span className="canvas-grid absolute inset-0" />
                    <span className="relative flex size-11 items-center justify-center rounded-lg border border-line bg-panel text-[22px] shadow-1 transition-transform group-hover:scale-105">{s.icon || '◇'}</span>
                    {s.pinned && (
                      <span className="absolute right-2.5 top-2.5 text-fg-3">
                        <Pin className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="p-3.5">
                    <div className="truncate text-[13.5px] font-medium">{s.title}</div>
                    <div className="mt-0.5 line-clamp-2 min-h-[2.6em] text-[12.5px] leading-snug text-fg-3">{s.description || 'No description'}</div>
                    <div className="mt-2.5 font-mono text-[11px] text-fg-3">updated {timeAgo(s.updated_at)}</div>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Page>
    </>
  );
}

/** Load a space and keep it fresh as the agent changes it. */
export function useSpace(id: string, onGone?: () => void) {
  const [space, setSpace] = useState<Space | null>(null);
  const load = useCallback(() => void api.get<Space>(`/spaces/${id}`).then(setSpace).catch(() => onGone?.()), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'space.changed' && ev.id === id && (ev.deleted ? onGone?.() : load()));
  }, [id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { space, load };
}

/** The sandboxed space itself, with the bridge to Sable (data and questions). Used full-page and in the side panel. */
export function SpaceFrame({ space, nonce = 0, className }: { space: Space; nonce?: number; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const id = space.id;
  const dataRef = useRef<Record<string, unknown>>({});
  // Keys this frame just wrote: don't bounce the server's echo back into it.
  const echoes = useRef(new Set<string>());
  // Live data: the agent, watchers and routines update a space without reloading it.
  useEffect(
    () =>
      onServerEvent((ev) => {
        if (ev.type !== 'space.data' || ev.id !== id) return;
        const key = String(ev.key);
        dataRef.current[key] = ev.value;
        if (echoes.current.delete(key)) return;
        frame.current?.contentWindow?.postMessage({ __sableData: true, key, value: ev.value }, '*');
      }),
    [id],
  );
  useEffect(() => {
    if (space) dataRef.current = { ...space.data };
  }, [space]);
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow || !e.data?.__sable) return;
      const { id: rid, type, payload } = e.data;
      const reply = (result?: unknown, error?: string) => frame.current?.contentWindow?.postMessage({ __sableReply: true, id: rid, result, error }, '*');
      try {
        if (type === 'get') reply(dataRef.current[payload.key] ?? null);
        else if (type === 'all') reply(dataRef.current);
        else if (type === 'set') {
          dataRef.current[payload.key] = payload.value;
          echoes.current.add(payload.key);
          await api.put(`/spaces/${id}/data`, { key: payload.key, value: payload.value });
          reply(true);
        } else if (type === 'act') {
          const r = await api.post<{ conversationId: string }>(`/spaces/${id}/act`, { prompt: String(payload.prompt) });
          reply({ started: true, conversationId: r.conversationId });
        } else if (type === 'ask') {
          const r = await api.post<{ text: string }>(`/spaces/${id}/ask`, { prompt: String(payload.prompt) });
          reply(r.text);
        } else reply(undefined, `Unknown call ${type}`);
      } catch (err) {
        reply(undefined, (err as Error).message);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);

  // Served by the server with a sandbox CSP (opaque origin, no network); reloads when the space changes.
  const src = `/api/spaces/${space.id}/frame?theme=${resolvedTheme()}&v=${space.updated_at}-${nonce}`;
  return (
    <motion.iframe
      key={nonce}
      ref={frame}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      title={space.title}
      sandbox="allow-scripts allow-forms allow-modals allow-popups"
      src={src}
      className={cx('min-h-0 w-full flex-1 border-0 bg-bg', className)}
    />
  );
}

export function SpaceView({ id }: { id: string }) {
  const { space, load } = useSpace(id, () => navigate('/spaces', { replace: true }));
  const [nonce, setNonce] = useState(0);
  const toast = useStore((s) => s.toast);

  if (!space)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <TopBar
        crumbs={
          <button onClick={() => navigate('/spaces')} className="hover:text-fg">
            Spaces
          </button>
        }
        title={space.title}
        actions={
          <>
            <IconButton label="Reload" onClick={() => setNonce((n) => n + 1)}>
              <RotateCw className="size-3.5" />
            </IconButton>
            <IconButton label={space.pinned ? 'Unpin' : 'Pin'} onClick={() => void api.patch(`/spaces/${id}`, { pinned: !space.pinned }).then(load)} className={cx(space.pinned && 'text-fg')}>
              {space.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </IconButton>
            <IconButton
              label="Delete"
              className="hover:text-danger"
              onClick={async () => {
                if (!confirm(`Delete “${space.title}”?`)) return;
                await api.del(`/spaces/${id}`);
                toast({ title: 'Space deleted' });
                navigate('/spaces');
              }}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
            <Button size="sm" onClick={() => void startChat(`I'd like to change my "${space.title}" space (${space.id}). Ask me what I want different.`)}>
              <MessageSquare className="size-3.5" /> Edit with agent
            </Button>
          </>
        }
      />
      <SpaceFrame space={space} nonce={nonce} />
    </div>
  );
}
