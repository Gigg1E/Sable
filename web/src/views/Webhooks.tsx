import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, Copy, KeyRound, MessageSquare, Plus, RotateCw, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, IconButton, Input, Page, PageIntro, Select, Sheet, Spinner, Textarea, Toggle, TopBar } from '../components/ui';
import type { Channel, Settings } from '../lib/types';
import { api } from '../lib/api';
import { clockTime, cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Hook, HookEvent } from '../lib/types';

const absolute = (h: Pick<Hook, 'url'>) => (h.url.startsWith('/') ? location.origin + h.url : h.url);

function CopyField({ value, mono = true, secret }: { value: string; mono?: boolean; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(!secret);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken pl-2.5">
      <span className={cx('min-w-0 flex-1 truncate py-1.5 text-[12px] text-fg-2', mono && 'font-mono')}>{show ? value : '•'.repeat(24)}</span>
      {secret && (
        <button onClick={() => setShow((s) => !s)} className="px-1.5 text-[11px] text-fg-3 hover:text-fg">
          {show ? 'hide' : 'show'}
        </button>
      )}
      <IconButton
        label={copied ? 'Copied' : 'Copy'}
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </IconButton>
    </div>
  );
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function HookRow({ h }: { h: Hook }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<HookEvent[] | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!open) return;
    void api.get<HookEvent[]>(`/hooks/${h.id}/events`).then(setEvents);
    if (h.hasSecret) void api.get<{ secret: string }>(`/hooks/${h.id}/secret`).then((r) => setSecret(r.secret));
  }, [open, h.id, h.count, h.hasSecret]);

  async function sendTest() {
    setSending(true);
    const body = JSON.stringify({ message: 'Test event from Sable', status: 'ok', sent_at: new Date().toISOString() });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
    if (h.verify !== 'none' && secret) headers[h.verify === 'github' ? 'X-Hub-Signature-256' : 'X-Signature-256'] = 'sha256=' + (await hmacHex(secret, body));
    const res = await fetch(h.path, { method: 'POST', headers, body }).catch(() => null);
    toast(res?.ok ? { title: 'Test event delivered', tone: 'success' } : { title: 'Test failed', body: `HTTP ${res?.status ?? 'error'}`, tone: 'error' });
    setSending(false);
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel-2/50">
        <WebhookIcon className={cx('size-4 shrink-0', h.enabled ? 'text-fg-2' : 'text-fg-3')} />
        <div className="min-w-0 flex-1">
          <div className={cx('truncate text-[13.5px] font-medium', !h.enabled && 'text-fg-3')}>{h.name}</div>
          <div className="truncate text-[12px] text-fg-3">{[h.action.notify && 'notifies you', h.action.prompt && 'wakes the agent'].filter(Boolean).join(' · ') || 'logs only'}</div>
        </div>
        {h.verify !== 'none' && (
          <Badge tone="outline">
            <KeyRound className="size-3" /> {h.verify === 'github' ? 'GitHub signed' : 'HMAC signed'}
          </Badge>
        )}
        <div className="w-28 shrink-0 text-right">
          <div className="font-mono text-[12.5px] tabular">{h.count} calls</div>
          <div className="text-[11px] tabular-nums text-fg-3">{h.last_received ? timeAgo(h.last_received) : 'never'}</div>
        </div>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-fg-3">
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="space-y-4 px-4 pb-4 pl-11">
              <Field label="Endpoint" hint="Send POST (JSON, form or text) or GET with query parameters. Keep it private: anyone with the URL can trigger it.">
                <CopyField value={absolute(h)} />
              </Field>
              {h.hasSecret && secret && (
                <Field label="Signing secret" hint={h.verify === 'github' ? 'Paste into GitHub → Settings → Webhooks → Secret. Requests are checked with X-Hub-Signature-256.' : 'Sign the raw body with HMAC-SHA256 and send it as X-Signature-256: sha256=<hex>.'}>
                  <CopyField value={secret} secret />
                </Field>
              )}
              {h.action.prompt && (
                <div className="text-[12.5px]">
                  <span className="text-fg-3">Agent instruction: </span>
                  <span className="text-fg-2">{h.action.prompt}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" onClick={() => void sendTest()} loading={sending}>
                  {!sending && <Send className="size-3.5" />} Send test event
                </Button>
                {h.conversation_id && (
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/chat/${h.conversation_id}`)}>
                    <MessageSquare className="size-3.5" /> Agent runs
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => confirm('Generate a new URL? The old one stops working immediately.') && void api.post(`/hooks/${h.id}/rotate`)}>
                  <RotateCw className="size-3.5" /> New URL
                </Button>
                <span className="flex-1" />
                <span className="flex items-center gap-2 text-[12px] text-fg-3">
                  Enabled <Toggle size="sm" checked={h.enabled} onChange={(v) => void api.patch(`/hooks/${h.id}`, { enabled: v })} />
                </span>
                <IconButton label="Delete webhook" className="hover:text-danger" onClick={() => confirm(`Delete “${h.name}”?`) && void api.del(`/hooks/${h.id}`)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-fg-3">Recent deliveries</div>
                {!events ? (
                  <Spinner className="size-3.5" />
                ) : events.length ? (
                  <div className="max-h-72 overflow-y-auto rounded-md border border-line">
                    {events.map((e) => (
                      <details key={e.id} className="group border-b border-line last:border-0">
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-1.5 font-mono text-[11.5px] hover:bg-panel-2/50">
                          <span className="w-36 shrink-0 text-fg-3">{clockTime(e.ts)}</span>
                          <span className="w-10 text-fg-3">{e.method}</span>
                          <Badge tone={e.status === 'accepted' ? 'ok' : 'danger'}>{e.status}</Badge>
                          <span className="min-w-0 flex-1 truncate text-fg-3">{e.detail}</span>
                        </summary>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-line bg-sunken p-2.5 font-mono text-[11px] text-fg-2">{e.body || '(empty body)'}</pre>
                      </details>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-line px-3 py-3 text-[12px] text-fg-3">No deliveries yet. Send a test event to try it.</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function NewHook({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [notifyOn, setNotify] = useState(true);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [verify, setVerify] = useState<Hook['verify']>('none');
  const [created, setCreated] = useState<Hook | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    onClose();
    setTimeout(() => (setCreated(null), setName(''), setTitle(''), setPrompt(''), setVerify('none')), 200);
  }
  async function save() {
    setBusy(true);
    try {
      setCreated(await api.post<Hook>('/hooks', { name, verify, action: { notify: notifyOn, title: title || undefined, prompt: prompt || undefined } }));
    } catch (err) {
      toast({ title: 'Could not create webhook', body: (err as Error).message, tone: 'error' });
    }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={close} wide title={created ? 'Webhook ready' : 'New webhook'} description={created ? 'Give this URL to the service that should trigger it.' : 'A private URL other services can call to notify you or wake the agent.'}>
      {created ? (
        <div className="space-y-4">
          <Field label="Endpoint">
            <CopyField value={absolute(created)} />
          </Field>
          {created.secret && (
            <Field label="Signing secret" hint="Also visible later on the webhook's page.">
              <CopyField value={created.secret} />
            </Field>
          )}
          <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-[11.5px] text-fg-2">{`curl -X POST '${absolute(created)}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"message": "Backup finished", "status": "ok"}'`}</pre>
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GitHub builds" />
          </Field>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[13px] font-medium">Notify me on each call</span>
              <span className="block text-xs text-fg-3">The notification shows a short summary of the payload.</span>
            </span>
            <Toggle checked={notifyOn} onChange={setNotify} />
          </label>
          {notifyOn && (
            <Field label="Notification title (optional)" hint={<>Use values from the payload, e.g. <code className="font-mono">{'Build {{body.workflow_run.conclusion}}'}</code></>}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={name || 'Webhook'} className="font-mono" />
            </Field>
          )}
          <Field label="Ask the agent to act (optional)" hint="The agent runs in the background with the payload attached as untrusted data. Sensitive actions still need your approval.">
            <Textarea className="!min-h-14" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="If the build failed, read the error, summarize the likely cause and notify me." />
          </Field>
          <Field label="Signature verification">
            <Select value={verify} onChange={(e) => setVerify(e.target.value as Hook['verify'])}>
              <option value="none">None (secret URL only)</option>
              <option value="github">GitHub (X-Hub-Signature-256)</option>
              <option value="hmac-sha256">HMAC-SHA256 (X-Signature-256)</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
              Create webhook
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

const KINDS: { re: RegExp; type: Channel['type']; label: string }[] = [
  { re: /discord(app)?\.com\/api\/webhooks/, type: 'discord', label: 'Discord' },
  { re: /hooks\.slack\.com/, type: 'slack', label: 'Slack' },
  { re: /ntfy/, type: 'ntfy', label: 'ntfy' },
];
const kindOf = (url: string) => KINDS.find((k) => k.re.test(url)) ?? { type: 'webhook' as const, label: 'Webhook' };

/** Places Sable pushes to (stored as notification channels). */
function OutputsSection() {
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tests, setTests] = useState<Record<string, string>>({});
  const outputs = settings?.channels ?? [];
  async function save(next: Channel[]) {
    if (!settings) return;
    const saved = await api.put<Settings>('/settings', { ...settings, channels: next });
    useStore.setState({ settings: saved });
  }
  return (
    <section className="mb-10">
      <h2 className="text-[15px] font-semibold">Outputs</h2>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
        Places {settings?.persona.name ?? 'Sable'} can push to: a Discord or Slack channel, ntfy, or any URL. Watchers, routines and chats can send to them by name ("post price drops to Deals Discord"). Paste a link here, or give it to the agent in chat.
      </p>
      <Card className="mt-4 divide-y divide-line">
        {outputs.map((c, i) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium">{c.name}</div>
              <div className="truncate font-mono text-[11.5px] text-fg-3">
                {KINDS.find((k) => k.type === c.type)?.label ?? 'Webhook'} · {c.url.replace(/^https?:\/\//, '').split('/')[0]}
              </div>
            </div>
            <Select
              value={c.events}
              onChange={(e) => void save(outputs.map((x, j) => (j === i ? { ...x, events: e.target.value as Channel['events'] } : x)))}
              className="!h-7 !w-auto !text-[12px]"
              aria-label="What it receives"
            >
              <option value="none">Only what's sent to it</option>
              <option value="important">+ important notifications</option>
              <option value="all">+ all notifications</option>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await api.post<{ ok: boolean; error?: string }>('/channels/test', c).catch((err: Error) => ({ ok: false, error: err.message }));
                setTests((t) => ({ ...t, [c.id]: r.ok ? 'Delivered' : (r.error ?? 'Failed') }));
              }}
            >
              <Send className="size-3.5" /> Test
            </Button>
            <Toggle size="sm" checked={c.enabled} onChange={(v) => void save(outputs.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} label="Enabled" />
            <IconButton label="Remove" className="hover:text-danger" onClick={() => void save(outputs.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </IconButton>
            {tests[c.id] && <div className={cx('basis-full text-[12px]', tests[c.id] === 'Delivered' ? 'text-ok' : 'text-danger')}>{tests[c.id]}</div>}
          </div>
        ))}
        <form
          className="flex flex-wrap items-end gap-2 px-4 py-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!/^https:\/\//.test(url.trim())) return toast({ title: 'Paste an https:// link', tone: 'error' });
            const k = kindOf(url.trim());
            let id = (name || k.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'webhook';
            while (outputs.some((c) => c.id === id)) id += '-2';
            await save([...outputs, { id, name: name.trim() || `${k.label} ${outputs.length + 1}`, type: k.type, url: url.trim(), enabled: true, events: 'none' }]);
            setName('');
            setUrl('');
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deals Discord" className="sm:w-44" />
          </Field>
          <div className="min-w-[220px] flex-1">
            <Field label="Webhook link">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
            </Field>
          </div>
          <Button size="sm" type="submit" disabled={!url.trim()}>
            <Plus className="size-3.5" /> Add output
          </Button>
        </form>
      </Card>
      <p className="mt-2 text-[12px] text-fg-3">Discord: channel settings → Integrations → Webhooks → New webhook → Copy URL. Slack: an app with Incoming Webhooks.</p>
    </section>
  );
}

export function WebhooksView() {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => void api.get<Hook[]>('/hooks').then(setHooks), []);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'hook.changed' && load());
  }, [load]);
  const isLocal = /^(localhost|127\.)/.test(location.hostname);

  return (
    <>
      <TopBar
        title="Webhooks"
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> New push URL
          </Button>
        }
      />
      <Page width="lg">
        <PageIntro title="Webhooks" description="Outputs are places Sable pushes to. Push URLs are private links other services call to wake Sable (they work like a watcher)." />
        <OutputsSection />
        <h2 className="mb-1 text-[15px] font-semibold">Push URLs</h2>
        <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-fg-2">Private URLs that GitHub, Home Assistant, IFTTT, uptime monitors or your own scripts can call to notify you or hand work to the agent.</p>
        {isLocal && (
          <div className="mb-5 rounded-md border border-line bg-panel-2/60 px-3.5 py-2.5 text-[12.5px] text-fg-2">
            You're on <code className="font-mono">localhost</code>. Outside services need your server's public address. Set it in Settings → Network so the URLs below use it.
          </div>
        )}
        {hooks && !hooks.length ? (
          <Empty
            icon={<WebhookIcon className="size-4" />}
            title="No webhooks yet"
            body="Create one here, or ask in chat: “ping me when my GitHub build fails”."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" /> New webhook
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {(hooks ?? []).map((h) => (
                <HookRow key={h.id} h={h} />
              ))}
            </AnimatePresence>
          </Card>
        )}
      </Page>
      <NewHook open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
