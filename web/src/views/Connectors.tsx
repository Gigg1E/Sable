import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, ChevronRight, ExternalLink, KeyRound, LogIn, LogOut, Plug, Plus, Server, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Segmented, Sheet, StatusDot, Textarea, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { CONNECTOR_PRESETS, type ConnectorPreset } from '../lib/connectorPresets';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { McpServerConfig, Settings, ToolInfo } from '../lib/types';

type Edit = (fn: (d: Settings) => void) => void;
interface Status {
  id: string;
  state: 'connected' | 'error' | 'disabled' | 'connecting' | 'needs_auth';
  error?: string;
  tools: string[];
  oauth?: boolean;
}

const SETUP_LABEL: Record<ConnectorPreset['setup'], { label: string; icon: typeof Zap }> = {
  'one-click': { label: 'Sign in', icon: Zap },
  client: { label: 'Your Google client', icon: KeyRound },
  token: { label: 'Access token', icon: KeyRound },
  local: { label: 'Runs on server', icon: Server },
};

const linesToRecord = (text: string, sep: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(sep);
        return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
const recordToLines = (r: Record<string, string> | undefined, sep: string) => Object.entries(r ?? {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');

function Monogram({ name }: { name: string }) {
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[13px] font-semibold text-fg-2">{name.slice(0, 1)}</span>;
}

/** Start OAuth for a saved connector and send the browser to the provider. */
async function signIn(id: string) {
  const r = await api.post<{ ok: boolean; authUrl: string | null; error?: string }>(`/mcp/${id}/connect`);
  if (!r.ok) throw new Error(r.error ?? 'Could not start sign-in');
  if (r.authUrl) location.href = r.authUrl;
  else useStore.getState().toast({ title: 'Already connected', tone: 'success' });
}

function SetupSheet({ preset, onClose, onAdd }: { preset: ConnectorPreset | null; onClose: () => void; onAdd: (cfg: McpServerConfig) => Promise<void> }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [token, setToken] = useState('');
  const [callback, setCallback] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (preset) void api.get<{ callbackUrl: string }>(`/mcp/oauth/info?origin=${encodeURIComponent(location.origin)}`).then((r) => setCallback(r.callbackUrl));
    setClientId('');
    setClientSecret('');
    setToken('');
  }, [preset]);
  if (!preset) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const google = preset.setup === 'client';

  async function add() {
    if (!preset) return;
    setBusy(true);
    const cfg = structuredClone(preset.config) as McpServerConfig;
    if (google) cfg.oauth = { clientId: clientId.trim(), clientSecret: clientSecret.trim(), scope: '' };
    if (preset.setup === 'token') cfg.headers = { Authorization: `Bearer ${token.trim()}` };
    await onAdd({ ...cfg, id: '', enabled: true });
    setBusy(false);
  }

  return (
    <Sheet open={!!preset} onClose={onClose} wide title={`Connect ${preset.name}`} description={preset.vendor}>
      <div className="space-y-4 text-[13px]">
        {google && (
          <>
            <ol className="list-decimal space-y-2 pl-5 leading-relaxed text-fg-2">
              <li>
                In the <a className="text-fg underline underline-offset-2" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Auth Platform</a>, create a project and enable the {preset.name === 'Gmail' ? 'Gmail' : 'Google Calendar'} API and its MCP server (
                <a className="text-fg underline underline-offset-2" href={preset.docs} target="_blank" rel="noreferrer">Google's guide</a>). Google's MCP servers are in developer preview.
              </li>
              <li>
                Create an OAuth client of type <b>Web application</b>, and tick <b>“Use this client for an AI-powered agent”</b> (Google requires this for MCP).
              </li>
              <li>
                Add this <b>authorized redirect URI</b>:
                <code className="mt-1 block break-all rounded-md border border-line bg-sunken px-2.5 py-1.5 font-mono text-[12px] text-fg">{callback}</code>
              </li>
              <li>On the consent screen, add your Google account as a test user. Then paste the client below. You can reuse it for Gmail and Calendar.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client ID">
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" />
              </Field>
              <Field label="Client secret">
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-fg-3">
              This is the address you have Sable open at right now, so do the sign-in from the same address. It doesn't need to be public: Google only sends your browser back to it. Google requires <b>https</b> with a real domain name (a Tailscale <code>…ts.net</code> address works) or <code>http://localhost</code>; plain IP addresses are refused.
            </p>
          </>
        )}
        {preset.setup === 'token' && (
          <Field label="Personal access token" hint={<>Create a fine-grained token on GitHub (Settings → Developer settings) with access to the repos you want. <a className="underline" href={preset.docs} target="_blank" rel="noreferrer">Details</a></>}>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          </Field>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={google ? !clientId || !clientSecret : preset.setup === 'token' ? !token : false} onClick={() => void add()}>
            {google ? 'Save and sign in with Google' : 'Add connector'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function ConnectorsSection({ draft, edit, saveNow, tools }: { draft: Settings; edit: Edit; saveNow: (next: Settings) => Promise<Settings | null>; tools: ToolInfo[] }) {
  const toast = useStore((s) => s.toast);
  const [status, setStatus] = useState<Status[]>([]);
  const [sheet, setSheet] = useState<ConnectorPreset | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const load = () => void api.get<Status[]>('/mcp').then(setStatus);
    load();
    // Returning from a provider's sign-in page.
    const q = new URLSearchParams(location.search);
    if (q.get('connected')) toast({ title: 'Account connected', body: 'Its tools are now available to the agent.', tone: 'success' });
    if (q.get('oauth_error')) toast({ title: 'Sign-in failed', body: q.get('oauth_error')!, tone: 'error' });
    if (q.size) navigate('/settings/connectors', { replace: true });
    return onServerEvent((ev) => ev.type === 'mcp.changed' && load());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addPreset(cfg: McpServerConfig) {
    let id = cfg.preset || 'connector';
    let n = 2;
    while (draft.mcpServers.some((s) => s.id === id)) id = `${cfg.preset}${n++}`;
    const next = structuredClone(draft);
    next.mcpServers.push({ ...cfg, id, enabled: true });
    const saved = await saveNow(next);
    setSheet(null);
    if (!saved) return;
    if (cfg.auth === 'oauth') {
      try {
        await signIn(id);
      } catch (err) {
        toast({ title: 'Could not start sign-in', body: (err as Error).message, tone: 'error' });
      }
    } else {
      const preset = CONNECTOR_PRESETS.find((p) => p.id === cfg.preset);
      toast({ title: `${cfg.name} added`, body: preset?.help, tone: 'success' });
    }
  }

  function choose(p: ConnectorPreset) {
    if (p.setup === 'one-click' || p.setup === 'local') void addPreset({ ...(structuredClone(p.config) as McpServerConfig), id: '', enabled: true });
    else setSheet(p);
  }

  async function allowReadOnly(serverId: string) {
    const prefix = `mcp_${serverId}_`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ro = tools.filter((t) => t.name.startsWith(prefix) && t.risk === 'low');
    if (!ro.length) return toast({ title: 'No read-only tools reported', body: 'This connector does not mark any tools as read-only.' });
    const next = structuredClone(draft);
    for (const t of ro) next.policies[t.name] = 'auto';
    if (await saveNow(next)) toast({ title: `${ro.length} read-only tools allowed`, body: 'Anything that changes data still asks first.', tone: 'success' });
  }

  return (
    <>
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Connect an account</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
          Official integrations use the Model Context Protocol. Sign-in happens on the provider's own page, and tokens stay on your server. Every connector action asks for your approval until you allow it.
        </p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {CONNECTOR_PRESETS.map((p, i) => {
            const added = draft.mcpServers.some((s) => s.preset === p.id);
            const S = SETUP_LABEL[p.setup];
            return (
              <motion.button
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { delay: i * 0.02 } }}
                onClick={() => !added && choose(p)}
                disabled={added}
                className={cx('flex flex-col rounded-lg border border-line bg-panel p-3.5 text-left shadow-1 transition-[border,box-shadow]', added ? 'opacity-60' : 'hover:border-line-strong hover:shadow-2')}
              >
                <div className="flex items-start gap-3">
                  <Monogram name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                      {p.name}
                      {p.badge && <Badge tone="outline">{p.badge}</Badge>}
                    </div>
                    <div className="text-[11.5px] text-fg-3">{p.vendor}</div>
                  </div>
                </div>
                <p className="mt-2.5 line-clamp-2 min-h-[2.6em] text-[12.5px] leading-snug text-fg-2">{p.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                    <S.icon className="size-3" /> {S.label}
                  </span>
                  <span className={cx('flex items-center gap-1 text-[12px] font-medium', added ? 'text-ok' : 'text-fg')}>
                    {added ? (
                      <>
                        <CheckCircle2 className="size-3.5" /> Added
                      </>
                    ) : (
                      <>
                        Connect <ChevronRight className="size-3.5" />
                      </>
                    )}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      <section className="mb-10">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Your connectors</h2>
            <p className="mt-1 text-[13px] text-fg-2">Or add any MCP server yourself: a remote URL (with sign-in or headers) or a local command.</p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              edit((d) => {
                let mid = 'custom';
                let n = 2;
                while (d.mcpServers.some((s) => s.id === mid)) mid = `custom${n++}`;
                d.mcpServers.push({ id: mid, name: 'Custom connector', enabled: true, transport: 'http', url: '', auth: 'oauth' });
                setOpenId(mid);
              })
            }
          >
            <Plus className="size-3.5" /> Custom
          </Button>
        </div>
        <div className="mt-4 space-y-2.5">
          {!draft.mcpServers.length && <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-3">No connectors yet. Pick one above.</p>}
          <AnimatePresence initial={false}>
            {draft.mcpServers.map((m, i) => {
              const st = status.find((s) => s.id === m.id);
              const set = (fn: (x: McpServerConfig) => void) => edit((d) => fn(d.mcpServers[i]));
              const open = openId === m.id;
              const preset = CONNECTOR_PRESETS.find((p) => p.id === m.preset);
              const dot = !m.enabled ? 'off' : st?.state === 'connected' ? 'ok' : st?.state === 'error' ? 'error' : st?.state === 'needs_auth' ? 'waiting' : 'idle';
              return (
                <motion.div key={m.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Card className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Monogram name={m.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13.5px] font-medium">
                          <StatusDot state={dot} /> {m.name}
                        </div>
                        <div className="truncate font-mono text-[11.5px] text-fg-3">{m.transport === 'http' ? m.url || 'no URL' : `${m.command} ${(m.args ?? []).join(' ')}`}</div>
                      </div>
                      <span className="text-[12px] text-fg-3">
                        {!m.enabled ? 'off' : st?.state === 'connected' ? `${st.tools.length} tools` : st?.state === 'needs_auth' ? <span className="text-accent">sign-in needed</span> : st?.state === 'error' ? <span className="text-danger">error</span> : 'connecting…'}
                      </span>
                      {m.enabled && m.auth === 'oauth' && st?.state === 'needs_auth' && (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busy === m.id}
                          onClick={async () => {
                            setBusy(m.id);
                            try {
                              await signIn(m.id);
                            } catch (err) {
                              toast({ title: 'Could not start sign-in', body: (err as Error).message, tone: 'error' });
                            }
                            setBusy(null);
                          }}
                        >
                          <LogIn className="size-3.5" /> Connect account
                        </Button>
                      )}
                      <Toggle size="sm" checked={m.enabled} onChange={(v) => set((x) => void (x.enabled = v))} label="Enabled" />
                      <button onClick={() => setOpenId(open ? null : m.id)} className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg" aria-label="Details">
                        <motion.span animate={{ rotate: open ? 90 : 0 }}>
                          <ChevronRight className="size-4" />
                        </motion.span>
                      </button>
                    </div>
                    {st?.error && <p className="border-t border-line px-4 py-2 text-[12px] text-danger">{st.error}</p>}
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="space-y-3.5 border-t border-line px-4 py-4">
                            {preset?.help && <p className="text-[12.5px] leading-relaxed text-fg-2">{preset.help}</p>}
                            {m.auth === 'oauth' && (
                              <div className="text-[12px] text-fg-3">
                                Redirect URI (must match your OAuth client exactly):
                                <code className="mt-1 block select-all break-all rounded-md border border-line bg-sunken px-2.5 py-1.5 font-mono text-fg">{location.origin}/api/mcp/oauth/callback</code>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {st?.state === 'connected' && (
                                <Button size="sm" onClick={() => void allowReadOnly(m.id)}>
                                  <ShieldCheck className="size-3.5" /> Allow read-only tools without asking
                                </Button>
                              )}
                              {m.auth === 'oauth' && st?.state === 'connected' && (
                                <Button size="sm" variant="ghost" onClick={() => void api.post(`/mcp/${m.id}/disconnect`)}>
                                  <LogOut className="size-3.5" /> Disconnect account
                                </Button>
                              )}
                              {preset?.docs && (
                                <a href={preset.docs} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-fg-2 hover:bg-panel-2 hover:text-fg">
                                  <ExternalLink className="size-3.5" /> Docs
                                </a>
                              )}
                              <span className="flex-1" />
                              <Button size="sm" variant="ghost" className="text-danger" onClick={() => edit((d) => void d.mcpServers.splice(i, 1))}>
                                <Trash2 className="size-3.5" /> Remove
                              </Button>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                              <Field label="Name">
                                <Input value={m.name} onChange={(e) => set((x) => void (x.name = e.target.value))} />
                              </Field>
                              <Field label="Type">
                                <Segmented id={`t-${m.id}`} size="sm" value={m.transport} onChange={(v) => set((x) => void (x.transport = v))} options={[{ value: 'http', label: 'Remote URL' }, { value: 'stdio', label: 'Local command' }]} />
                              </Field>
                            </div>
                            {m.transport === 'http' ? (
                              <>
                                <Field label="URL">
                                  <Input value={m.url ?? ''} placeholder="https://mcp.example.com/mcp" onChange={(e) => set((x) => void (x.url = e.target.value))} />
                                </Field>
                                <Field label="Authentication">
                                  <Segmented id={`a-${m.id}`} size="sm" value={m.auth ?? 'headers'} onChange={(v) => set((x) => void (x.auth = v))} options={[{ value: 'oauth', label: 'Sign in (OAuth)' }, { value: 'headers', label: 'Headers / token' }]} />
                                </Field>
                                {m.auth === 'oauth' ? (
                                  <div className="grid gap-3 sm:grid-cols-3">
                                    <Field label="Client ID (optional)" hint="Only for providers without dynamic registration.">
                                      <Input value={m.oauth?.clientId ?? ''} onChange={(e) => set((x) => void (x.oauth = { ...x.oauth, clientId: e.target.value }))} />
                                    </Field>
                                    <Field label="Client secret">
                                      <Input type="password" value={m.oauth?.clientSecret ?? ''} onChange={(e) => set((x) => void (x.oauth = { ...x.oauth, clientSecret: e.target.value }))} />
                                    </Field>
                                    <Field label="Scopes">
                                      <Input value={m.oauth?.scope ?? ''} placeholder="server default" onChange={(e) => set((x) => void (x.oauth = { ...x.oauth, scope: e.target.value }))} />
                                    </Field>
                                  </div>
                                ) : (
                                  <Field label="Headers" hint="Name: value, one per line.">
                                    <Textarea className="!min-h-14 font-mono text-xs" value={recordToLines(m.headers, ':')} onChange={(e) => set((x) => void (x.headers = linesToRecord(e.target.value, ':')))} />
                                  </Field>
                                )}
                              </>
                            ) : (
                              <>
                                <Field label="Command">
                                  <Input value={m.command ?? ''} placeholder="npx" onChange={(e) => set((x) => void (x.command = e.target.value))} />
                                </Field>
                                <Field label="Arguments" hint="One per line.">
                                  <Textarea className="!min-h-14 font-mono text-xs" value={(m.args ?? []).join('\n')} onChange={(e) => set((x) => void (x.args = e.target.value.split('\n').filter(Boolean)))} />
                                </Field>
                                <Field label="Environment" hint="KEY=value, one per line.">
                                  <Textarea className="!min-h-14 font-mono text-xs" value={recordToLines(m.env, '=')} onChange={(e) => set((x) => void (x.env = linesToRecord(e.target.value, '=')))} />
                                </Field>
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-fg-3">
          <Plug className="size-3" /> Changes to existing connectors apply when you save.
        </p>
      </section>
      <SetupSheet preset={sheet} onClose={() => setSheet(null)} onAdd={addPreset} />
    </>
  );
}
