import { AnimatePresence, motion } from 'motion/react';
import { LayoutGrid, MessageSquare, Pin, PinOff, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, IconButton, Page, PageIntro, Spinner, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
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

/** Builds the sandboxed document: CSP blocks all network except a couple of script CDNs. */
function buildDoc(space: Space) {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const theme = `:root{--bg:${v('--bg')};--surface:${v('--panel')};--surface-2:${v('--panel-2')};--fg:${v('--fg')};--muted:${v('--fg-2')};--subtle:${v('--fg-3')};--accent:${v('--accent')};--ok:${v('--ok')};--danger:${v('--danger')};--border:${v('--line')};--radius:10px;color-scheme:${v('color-scheme') || 'dark'}}
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}`;
  const bridge = `(function(){var n=0,p={};function call(t,x){return new Promise(function(res,rej){var id=++n;p[id]={res:res,rej:rej};parent.postMessage({__sable:true,id:id,type:t,payload:x},'*')})}
window.sable={get:function(k){return call('get',{key:k})},set:function(k,v){return call('set',{key:k,value:v})},all:function(){return call('all')},ask:function(q){return call('ask',{prompt:q})}};
addEventListener('message',function(e){var d=e.data;if(d&&d.__sableReply&&p[d.id]){var x=p[d.id];delete p[d.id];d.error?x.rej(new Error(d.error)):x.res(d.result)}});})();`;
  const csp = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob: https:; media-src data: blob:; connect-src 'none'; form-action 'none'";
  const html = space.html.trim();
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${theme}</style><script>${bridge}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + head);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export function SpaceView({ id }: { id: string }) {
  const [space, setSpace] = useState<Space | null>(null);
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const toast = useStore((s) => s.toast);

  const load = useCallback(() => void api.get<Space>(`/spaces/${id}`).then(setSpace).catch(() => navigate('/spaces', { replace: true })), [id]);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'space.changed' && ev.id === id && (ev.deleted ? navigate('/spaces') : load()));
  }, [id, load]);

  // The bridge between the sandboxed space and Sable.
  const dataRef = useRef<Record<string, unknown>>({});
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
          await api.put(`/spaces/${id}/data`, { key: payload.key, value: payload.value });
          reply(true);
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

  const doc = useMemo(() => (space ? buildDoc(space) : ''), [space?.html, space?.id, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <motion.iframe
        key={nonce}
        ref={frame}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        title={space.title}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={doc}
        className="min-h-0 w-full flex-1 border-0 bg-bg"
      />
    </div>
  );
}
