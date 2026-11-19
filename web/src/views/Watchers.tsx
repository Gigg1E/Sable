import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, FlaskConical, MessageSquare, Pause, Play, Plus, Radar, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Sparkline } from '../components/Sparkline';
import { Badge, Button, Card, Empty, Field, IconButton, Input, Page, PageIntro, Select, Sheet, Spinner, StatusDot, Textarea, Toggle, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { clockTime, cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Condition, ExtractSpec, WatchPoint, Watcher } from '../lib/types';

const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
};
const every = (m: number) => (m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`);

const EXTRACT_LABEL: Record<ExtractSpec['kind'], string> = { price: 'Product price', selector: 'CSS selector', json: 'JSON path', regex: 'Pattern', text: 'Page text', ai: 'AI extraction' };

function extractDetail(e: ExtractSpec) {
  switch (e.kind) {
    case 'selector':
      return e.selector + (e.attribute ? ` @${e.attribute}` : '');
    case 'json':
      return e.path;
    case 'regex':
      return e.pattern;
    case 'text':
      return e.selector || 'whole page';
    case 'ai':
      return e.instruction;
    default:
      return 'schema.org / OpenGraph data';
  }
}

function WatcherRow({ w }: { w: Watcher }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<WatchPoint[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (open) void api.get<WatchPoint[]>(`/watchers/${w.id}/history`).then(setHistory);
  }, [open, w.id, w.last_checked]);
  const state = !w.enabled ? 'off' : w.last_error ? 'error' : 'ok';
  const isText = w.extract.kind === 'text';

  async function check() {
    setChecking(true);
    await api.post(`/watchers/${w.id}/check`).catch(() => {});
    setChecking(false);
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel-2/50">
        <StatusDot state={state} />
        <div className="min-w-0 flex-1">
          <div className={cx('truncate text-[13.5px] font-medium', !w.enabled && 'text-fg-3')}>{w.title}</div>
          <div className="truncate text-[12px] text-fg-3">
            {w.source && w.source !== 'web' ? w.sourceLabel : `${host(w.url)} · ${w.conditionLabel} · every ${every(w.interval_min)}`}
          </div>
        </div>
        <Sparkline points={w.spark} width={96} height={28} className="hidden shrink-0 sm:block" />
        <div className="w-28 shrink-0 text-right">
          <div className={cx('truncate font-mono text-[13px] tabular', w.last_error ? 'text-danger' : 'text-fg')}>{w.last_error ? 'error' : isText ? (w.last_value ? 'tracking' : '—') : (w.last_value ?? '—')}</div>
          <div className="font-mono text-[10.5px] text-fg-3">{w.last_checked ? `checked ${timeAgo(w.last_checked)}` : 'pending'}</div>
        </div>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-fg-3">
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="grid gap-5 px-4 pb-4 pl-9 md:grid-cols-[1fr_260px]">
              <div className="min-w-0 space-y-3">
                {w.last_error && (
                  <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w.last_error}
                  </div>
                )}
                {w.spark.length > 1 && (
                  <div className="rounded-md border border-line bg-sunken p-3">
                    <Sparkline points={w.spark} width={520} height={84} className="h-auto w-full" />
                    <div className="mt-1 flex justify-between font-mono text-[10.5px] text-fg-3">
                      <span>{clockTime(w.spark[0].ts)}</span>
                      <span>
                        low {Math.min(...w.spark.map((p) => p.numeric ?? Infinity))} · high {Math.max(...w.spark.map((p) => p.numeric ?? -Infinity))}
                      </span>
                    </div>
                  </div>
                )}
                {isText && w.last_value && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-2.5 font-mono text-[11.5px] text-fg-2">{w.last_value.slice(0, 1500)}</pre>}
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-fg-3">Changes</div>
                  {!history ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <div className="max-h-56 overflow-y-auto rounded-md border border-line">
                      {history.map((h) => (
                        <div key={h.ts} className="flex items-center gap-3 border-b border-line px-3 py-1.5 font-mono text-[11.5px] last:border-0">
                          <span className="w-36 shrink-0 text-fg-3">{clockTime(h.ts)}</span>
                          <span className="min-w-0 flex-1 truncate text-fg-2">{isText ? `${h.value.length} chars` : h.value}</span>
                          {!!h.triggered && <Badge tone="accent">triggered</Badge>}
                        </div>
                      ))}
                      {!history.length && <div className="px-3 py-2 text-[12px] text-fg-3">No readings yet.</div>}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3 text-[12.5px]">
                <dl className="space-y-2">
                  {[
                    w.source && w.source !== 'web'
                      ? ['Watches', w.sourceLabel]
                      : ['Page', <a key="u" href={w.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg hover:underline">{host(w.url)} <ExternalLink className="size-3" /></a>],
                    ['Reads', `${EXTRACT_LABEL[w.extract.kind]}: ${extractDetail(w.extract)}`],
                    ['Alerts when', w.conditionLabel],
                    ['Then', [w.actions.notify && 'notify', w.actions.webhook && `POST ${host(w.actions.webhook)}`, w.actions.prompt && `the agent: “${w.actions.prompt.slice(0, 120)}”`].filter(Boolean).join(', ') || 'log only'],
                    ['Next check', w.enabled && w.next_check ? clockTime(w.next_check) : 'paused'],
                    ['Last alert', w.last_triggered ? timeAgo(w.last_triggered) : 'never'],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex gap-3">
                      <dt className="w-20 shrink-0 text-fg-3">{k}</dt>
                      <dd className="min-w-0 break-words text-fg-2">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" onClick={() => void check()} loading={checking}>
                    {!checking && <RefreshCw className="size-3.5" />} Check now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void api.patch(`/watchers/${w.id}`, { enabled: !w.enabled })}>
                    {w.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {w.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  {w.conversation_id && (
                    <IconButton label="Open chat" onClick={() => navigate(`/chat/${w.conversation_id}`)}>
                      <MessageSquare className="size-3.5" />
                    </IconButton>
                  )}
                  <IconButton label="Delete watcher" className="hover:text-danger" onClick={() => void api.del(`/watchers/${w.id}`)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const INTERVALS = [15, 30, 60, 180, 360, 720, 1440];

function NewWatcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExtractSpec['kind']>('price');
  const [param, setParam] = useState('');
  const [cond, setCond] = useState<Condition['kind']>('changed');
  const [condValue, setCondValue] = useState('');
  const [interval, setInterval_] = useState(60);
  const [notifyOn, setNotify] = useState(true);
  const [webhook, setWebhook] = useState('');
  const [prompt, setPrompt] = useState('');
  const [test, setTest] = useState<{ ok: boolean; value?: string; detail?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);

  const extract = (): ExtractSpec => {
    switch (kind) {
      case 'selector':
        return { kind, selector: param };
      case 'json':
        return { kind, path: param };
      case 'regex':
        return { kind, pattern: param };
      case 'text':
        return { kind, selector: param || undefined };
      case 'ai':
        return { kind, instruction: param };
      default:
        return { kind: 'price' };
    }
  };
  const needsValue = cond !== 'changed';
  const paramLabel = { selector: 'CSS selector', json: 'JSON path', regex: 'Regular expression (first group is the value)', text: 'CSS selector (optional)', ai: 'What to extract', price: '' }[kind];
  const paramPlaceholder = { selector: '.product-price', json: 'data.items[0].price', regex: 'Price: \\$([\\d.]+)', text: 'main article', ai: 'The price of the 256 GB model', price: '' }[kind];

  async function runTest() {
    setBusy('test');
    setTest(await api.post('/watchers/test', { url, extract: extract() }));
    setBusy(null);
  }
  async function save() {
    setBusy('save');
    try {
      await api.post('/watchers', {
        title: title || host(url),
        url,
        extract: extract(),
        condition: needsValue ? { kind: cond, value: condValue } : { kind: cond },
        interval_min: interval,
        actions: { notify: notifyOn, webhook: webhook || undefined, prompt: prompt || undefined },
      });
      toast({ title: 'Watcher created', body: 'The first check is running now.', tone: 'success' });
      onClose();
      setUrl('');
      setTitle('');
      setTest(null);
    } catch (err) {
      toast({ title: 'Could not create watcher', body: (err as Error).message, tone: 'error' });
    }
    setBusy(null);
  }

  return (
    <Sheet open={open} onClose={onClose} wide title="New watcher" description="Checks a page on a schedule and alerts you when your condition is met. Each check runs on the server, without the model.">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="URL">
            <Input value={url} onChange={(e) => (setUrl(e.target.value), setTest(null))} placeholder="https://shop.example.com/product/123" />
          </Field>
          <Field label="Name">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={url ? host(url) : 'Headphones price'} />
          </Field>
        </div>
        <Field label="What to read">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {(Object.keys(EXTRACT_LABEL) as ExtractSpec['kind'][]).map((k) => (
              <button key={k} type="button" onClick={() => (setKind(k), setParam(''), setTest(null))} className={cx('h-8 rounded-md border px-2 text-[12px] transition-colors', kind === k ? 'border-fg/40 bg-panel-3 text-fg' : 'border-line text-fg-2 hover:border-line-strong')}>
                {EXTRACT_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
        {kind === 'price' ? (
          <p className="-mt-2 text-xs leading-relaxed text-fg-3">Reads the price and stock status most shops publish for search engines (schema.org JSON-LD, OpenGraph and microdata). Works on most product pages without configuration.</p>
        ) : (
          <Field label={paramLabel} hint={kind === 'ai' ? 'Uses your main model on every check. Use it when nothing else works.' : undefined}>
            <Input value={param} onChange={(e) => (setParam(e.target.value), setTest(null))} placeholder={paramPlaceholder} className="font-mono" />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => void runTest()} loading={busy === 'test'} disabled={!/^https?:\/\//.test(url)}>
            {busy !== 'test' && <FlaskConical className="size-3.5" />} Test extraction
          </Button>
          <AnimatePresence mode="wait">
            {test && (
              <motion.div key={String(test.ok) + test.value} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={cx('flex min-w-0 items-center gap-1.5 text-[12.5px]', test.ok ? 'text-fg' : 'text-danger')}>
                {test.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-ok" /> : <AlertTriangle className="size-3.5 shrink-0" />}
                <span className="truncate font-mono">{test.ok ? test.value?.slice(0, 120) : test.error}</span>
                {test.detail && <span className="truncate text-fg-3">· {test.detail}</span>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_140px_140px]">
          <Field label="Alert when">
            <Select value={cond} onChange={(e) => setCond(e.target.value as Condition['kind'])}>
              <option value="changed">It changes</option>
              <option value="below">Drops below…</option>
              <option value="above">Rises above…</option>
              <option value="drop_percent">Falls by % …</option>
              <option value="rise_percent">Rises by % …</option>
              <option value="contains">Contains text…</option>
              <option value="not_contains">Stops containing text…</option>
            </Select>
          </Field>
          <Field label="Value">
            <Input value={condValue} disabled={!needsValue} onChange={(e) => setCondValue(e.target.value)} placeholder={cond === 'contains' || cond === 'not_contains' ? 'In stock' : needsValue ? '200' : '—'} />
          </Field>
          <Field label="Check every">
            <Select value={interval} onChange={(e) => setInterval_(Number(e.target.value))}>
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {every(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[13px] font-medium">Notify me</span>
              <span className="block text-xs text-fg-3">Push to your devices and any channels set up in Settings → Notifications.</span>
            </span>
            <Toggle checked={notifyOn} onChange={setNotify} />
          </label>
          <Field label="Also POST to a webhook (optional)" hint="Sends JSON with the previous and current value, e.g. to Home Assistant, n8n or Zapier.">
            <Input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Ask the agent to act (optional)" hint="Runs in the background when the alert fires, with the new value attached.">
            <Textarea className="!min-h-14" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Compare this price with two other stores and tell me if it's the best deal." />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!/^https?:\/\//.test(url) || (kind !== 'price' && kind !== 'text' && !param) || (needsValue && !condValue)} onClick={() => void save()}>
            Create watcher
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function WatchersView() {
  const [watchers, setWatchers] = useState<Watcher[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => void api.get<Watcher[]>('/watchers').then(setWatchers), []);
  useEffect(() => {
    load();
    let t: ReturnType<typeof setTimeout>;
    return onServerEvent((ev) => {
      if (ev.type === 'watcher.changed') {
        clearTimeout(t);
        t = setTimeout(load, 150);
      }
    });
  }, [load]);

  return (
    <>
      <TopBar
        title="Watchers"
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New watcher
          </Button>
        }
      />
      <Page width="lg">
        <PageIntro
          title="Watchers"
          description="Prices, stock, pages and APIs the server checks on a schedule. You get an alert only when your condition is met. Or just ask in chat: “watch this and tell me if it drops under $200”."
        />
        {watchers && !watchers.length ? (
          <Empty
            icon={<Radar className="size-4" />}
            title="Nothing being watched"
            body="Track a price, a restock, a status page or any value from an API."
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" /> New watcher
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('/')}>
                  Ask the agent
                </Button>
              </div>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {(watchers ?? []).map((w) => (
                <WatcherRow key={w.id} w={w} />
              ))}
            </AnimatePresence>
          </Card>
        )}
      </Page>
      <NewWatcher open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
