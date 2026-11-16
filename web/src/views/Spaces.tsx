import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, LayoutGrid, MessageCircle, Pin, PinOff, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, IconButton, PageHeader, Spinner } from '../components/ui';
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
        <PageHeader title="Spaces" subtitle="Little apps Sable builds for you: trackers, dashboards, planners." />
        {spaces && !spaces.length ? (
          <Empty
            icon={<LayoutGrid className="size-6" />}
            title="No spaces yet"
            body="Describe what you want and Sable will build it. It saves its own data and you can pin it."
            action={
              <Button variant="primary" onClick={() => void startChat('Build me a Space: a simple reading list where I can add books, mark them read, and see how many I finished this year.')}>
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
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate(`/spaces/${s.id}`)}
                  className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-5 text-left shadow-soft"
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-accent/10 blur-2xl transition-opacity group-hover:opacity-100 opacity-50" />
                  <div className="relative flex items-start justify-between">
                    <span className="text-3xl">{s.icon || '✨'}</span>
                    {s.pinned && <Pin className="size-3.5 text-accent" />}
                  </div>
                  <h3 className="relative mt-4 font-semibold">{s.title}</h3>
                  <p className="relative mt-1 line-clamp-2 text-sm text-muted">{s.description || ' '}</p>
                  <p className="relative mt-3 text-xs text-subtle">Updated {timeAgo(s.updated_at)}</p>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

/** Builds the sandboxed document: CSP blocks all network except a couple of script CDNs. */
function buildDoc(space: Space) {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const theme = `:root{--bg:${v('--bg')};--surface:${v('--surface')};--surface-2:${v('--surface-2')};--fg:${v('--fg')};--muted:${v('--muted')};--accent:${v('--accent')};--accent-2:${v('--accent-2')};--border:${v('--border')};--radius:16px;color-scheme:${v('color-scheme') || 'dark'}}
html,body{margin:0;background:var(--bg);color:var(--fg);font-family:${v('--font-sans') || 'system-ui'},system-ui,sans-serif;-webkit-font-smoothing:antialiased}
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
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2 py-2 md:px-4">
        <IconButton label="Back" onClick={() => navigate('/spaces')}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <span className="text-xl">{space.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">{space.title}</div>
          {space.description && <div className="truncate text-xs text-muted">{space.description}</div>}
        </div>
        <IconButton label="Reload" onClick={() => setNonce((n) => n + 1)}>
          <RotateCw className="size-4" />
        </IconButton>
        <IconButton
          label={space.pinned ? 'Unpin' : 'Pin'}
          onClick={() => void api.patch(`/spaces/${id}`, { pinned: !space.pinned }).then(load)}
          className={cx(space.pinned && 'text-accent')}
        >
          {space.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </IconButton>
        <IconButton label="Change it" onClick={() => void startChat(`I'd like to change my "${space.title}" space (${space.id}). Ask me what I want different.`)}>
          <MessageCircle className="size-4" />
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
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <motion.iframe
        key={nonce}
        ref={frame}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        title={space.title}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={doc}
        className="min-h-0 w-full flex-1 bg-bg"
      />
    </div>
  );
}
