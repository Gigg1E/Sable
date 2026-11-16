import { AnimatePresence, motion } from 'motion/react';
import { ShoppingBag } from 'lucide-react';
import { BarChart3, Bell, Bot, CheckCircle2, Code2, Cpu, Download, Globe, Map as MapIcon, PenLine, Plug, Plus, RefreshCw, Search, Shield, Trash2, User, XCircle, Zap } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Field, Input, Segmented, Select, Spinner, Textarea, Toggle, TopBar } from '../components/ui';
import { AGENT_TEMPLATES } from '../lib/agentTemplates';
import { ConnectorsSection } from './Connectors';
import { ShoppingSection } from './Shopping';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { disablePush, enablePush, pushState } from '../lib/push';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { AgentProfile, Effort, McpServerConfig, Policy, ProviderConfig, Settings, ToolInfo } from '../lib/types';

const SECTIONS = [
  { id: 'general', label: 'General', icon: User },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'agents', label: 'Sub-agents', icon: Bot },
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'shopping', label: 'Shopping', icon: ShoppingBag },
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'notifications', label: 'Notifications', icon: Bell },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const PROVIDER_TYPES: { value: ProviderConfig['type']; label: string; base?: string; key?: boolean }[] = [
  { value: 'ollama', label: 'Ollama', base: 'http://127.0.0.1:11434' },
  { value: 'llamacpp', label: 'llama.cpp server', base: 'http://127.0.0.1:8080/v1' },
  { value: 'anthropic', label: 'Claude (Anthropic)', key: true },
  { value: 'openai', label: 'OpenAI', base: 'https://api.openai.com/v1', key: true },
  { value: 'openai-compatible', label: 'OpenAI-compatible (LM Studio, vLLM…)', base: 'http://127.0.0.1:1234/v1', key: true },
];
const EFFORTS: { value: Effort; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';

// ───────────────────────── Model lists ─────────────────────────

const modelCache = new Map<string, Promise<{ ok: boolean; models: string[]; error?: string }>>();
function fetchModels(providerId: string, refresh = false) {
  if (refresh || !modelCache.has(providerId)) modelCache.set(providerId, api.post('/providers/models', { id: providerId }));
  return modelCache.get(providerId)!;
}

const sameModel = (a: string, b: string) => a === b || a === `${b}:latest` || b === `${a}:latest`;

interface PullState {
  status: string;
  completed?: number;
  total?: number;
  detail?: string;
  error?: string;
}

/** Download button + progress for an Ollama model that isn't installed yet. */
function OllamaPull({ providerId, model, onDone }: { providerId: string; model: string; onDone: () => void }) {
  const [pull, setPull] = useState<PullState | null>(null);
  useEffect(() => {
    setPull(null);
    return onServerEvent((ev) => {
      if (ev.type !== 'model.pull' || ev.providerId !== providerId || ev.model !== model) return;
      setPull(ev);
      if (ev.status === 'success') onDone();
    });
  }, [providerId, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = pull?.total ? Math.round(((pull.completed ?? 0) / pull.total) * 100) : 0;
  const busy = pull && pull.status !== 'error' && pull.status !== 'success';
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-md border border-accent/30 bg-accent-soft p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium text-accent">{model}</span> <span className="text-fg-2">isn't installed in Ollama yet.</span>
          {pull?.status === 'error' && <div className="mt-0.5 text-danger">{pull.error}</div>}
          {busy && <div className="mt-0.5 truncate text-fg-3">{pull.detail ?? 'Starting…'}{pull.total ? ` · ${pct}%` : ''}</div>}
        </div>
        <Button size="sm" loading={!!busy} disabled={!!busy} onClick={() => void api.post(`/providers/${providerId}/pull`, { model }).catch((e) => setPull({ status: 'error', error: (e as Error).message }))}>
          {!busy && <Download className="size-3.5" />} {busy ? 'Downloading' : 'Download'}
        </Button>
      </div>
      {busy && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-fg-2 to-fg" animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 60, damping: 18 }} />
        </div>
      )}
    </motion.div>
  );
}

function ModelPicker({ providerId, value, onChange, placeholder }: { providerId: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const providerType = useStore((s) => s.settings?.providers.find((p) => p.id === providerId)?.type);
  const load = (refresh = false) => {
    setLoading(true);
    void fetchModels(providerId, refresh).then((r) => {
      setModels(r.models);
      setError(r.ok ? '' : (r.error ?? ''));
      setLoading(false);
      setLoaded(r.ok);
    });
  };
  useEffect(() => load(), [providerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = providerType === 'ollama' && loaded && value.trim() !== '' && !models.some((m) => sameModel(m, value.trim()));
  const listId = `models-${providerId}`;
  return (
    <div>
      <div className="flex gap-2">
        <Input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? (models[0] ? `e.g. ${models[0]}` : 'model name')} />
        <Button variant="secondary" onClick={() => load(true)} aria-label="Refresh models">
          {loading ? <Spinner /> : <RefreshCw className="size-4" />}
        </Button>
      </div>
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {models.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {models.slice(0, 12).map((m) => (
            <button key={m} type="button" onClick={() => onChange(m)} className={cx('rounded-lg border px-2 py-0.5 text-xs transition-colors', value === m ? 'border-fg/30 bg-panel-3 text-fg' : 'border-line text-fg-2 hover:text-fg')}>
              {m}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      {missing && <OllamaPull providerId={providerId} model={value.trim()} onDone={() => load(true)} />}
    </div>
  );
}

/** Temperature + context window, mostly useful for local models. */
function Tuning({ temperature, contextLength, onChange, showContext }: { temperature?: number | null; contextLength?: number | null; onChange: (t: { temperature?: number | null; contextLength?: number | null }) => void; showContext: boolean }) {
  return (
    <>
      <Field label="Temperature" hint="Lower is more precise (coding), higher more creative (writing). Empty = model default.">
        <Input type="number" step="0.1" min={0} max={2} value={temperature ?? ''} placeholder="default" onChange={(e) => onChange({ temperature: e.target.value === '' ? null : Number(e.target.value) })} />
      </Field>
      {showContext && (
        <Field label="Context window (tokens)" hint="Ollama's num_ctx. Agents need room for tools and history; 16k–32k is a good start if your GPU allows.">
          <Input type="number" step="1024" min={2048} value={contextLength ?? ''} placeholder="model default" onChange={(e) => onChange({ contextLength: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
      )}
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

const TEMPLATE_ICONS = { code: Code2, search: Search, pen: PenLine, chart: BarChart3, map: MapIcon, zap: Zap };

function NetworkSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [proxy, setProxy] = useState<string | null | undefined>(undefined);
  const [check, setCheck] = useState<{ ok: boolean; ip?: string; viaProxy?: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.get<{ proxy: string | null }>('/network').then((r) => setProxy(r.proxy));
  }, []);
  return (
    <>
    <Section title="Public address" description="The URL people and services use to reach this server. Inbound webhook URLs and links in notifications are built from it.">
      <Field label="Public URL" hint={draft.publicUrl ? undefined : `Not set. Using the address you last opened Sable from${location.hostname === 'localhost' ? ' (localhost won\u2019t work for outside services)' : `: ${location.origin}`}.`}>
        <Input value={draft.publicUrl} placeholder={location.origin} onChange={(e) => edit((d) => void (d.publicUrl = e.target.value.trim()))} />
      </Field>
    </Section>
    <Section
      title="Outbound network"
      description="Where the agent's own internet traffic goes: web search, page reads, HTTP requests, scripts and local connectors. Model APIs and Ollama are not affected."
    >
      <Card className="divide-y divide-line">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Shield className={cx('size-4', proxy ? 'text-ok' : 'text-fg-3')} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{proxy === undefined ? 'Checking…' : proxy ? 'Routed through a VPN proxy' : 'Direct (server IP)'}</div>
            <div className="text-xs text-fg-3">
              {proxy ? (
                <>
                  Proxy <code className="font-mono">{proxy}</code>. If it goes down, agent web access stops instead of falling back to your IP.
                </>
              ) : (
                <>
                  Sites the agent visits see this server's IP address. Set <code className="font-mono">SABLE_AGENT_PROXY</code> to route through a VPN container (see the README).
                </>
              )}
            </div>
          </div>
          <Badge tone={proxy ? 'ok' : 'default'}>{proxy ? 'protected' : 'direct'}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Exit IP</div>
            <div className="text-xs text-fg-3">Asks api.ipify.org which address the agent's requests come from.</div>
          </div>
          {check && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cx('font-mono text-[12px]', check.ok ? 'text-fg' : 'text-danger')}>
              {check.ok ? check.ip : check.error}
            </motion.span>
          )}
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setCheck(await api.post('/network/check'));
              setBusy(false);
            }}
          >
            Check exit IP
          </Button>
        </div>
      </Card>
    </Section>
    </>
  );
}

type Edit = (fn: (d: Settings) => void) => void;

// ───────────────────────── Sections ─────────────────────────

function GeneralSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('sable-theme') ?? 'system');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');
  function applyTheme(t: string) {
    setTheme(t);
    try {
      localStorage.setItem('sable-theme', t);
    } catch {
      /* ignore */
    }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  return (
    <>
      <Section title="Your agent" description="Give it a name and a voice.">
        <Field label="Name">
          <Input value={draft.persona.name} onChange={(e) => edit((d) => void (d.persona.name = e.target.value))} />
        </Field>
        <Field label="How it talks">
          <Textarea value={draft.persona.style} onChange={(e) => edit((d) => void (d.persona.style = e.target.value))} />
        </Field>
        <Field label="About you" hint="Anything your agent should always know: where you live, your work, your family, your preferences.">
          <Textarea value={draft.persona.about} onChange={(e) => edit((d) => void (d.persona.about = e.target.value))} placeholder="I live in Lisbon, work as a designer, and I'm vegetarian." />
        </Field>
      </Section>
      <Section title="Appearance">
        <Segmented id="theme" value={theme} onChange={applyTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Section>
      <Section title="Password" description="Changing it signs out every other device.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <Input type="password" placeholder="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={!pw.current || pw.next.length < 8}
            onClick={async () => {
              try {
                await api.post('/auth/password', pw);
                setPw({ current: '', next: '' });
                setPwMsg('Password changed.');
              } catch (err) {
                setPwMsg((err as Error).message);
              }
            }}
          >
            Change password
          </Button>
          {pwMsg && <span className="text-sm text-fg-2">{pwMsg}</span>}
        </div>
      </Section>
    </>
  );
}

function ProviderCard({ p, edit, index, removable }: { p: ProviderConfig; edit: Edit; index: number; removable: boolean }) {
  const meta = PROVIDER_TYPES.find((t) => t.value === p.type);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function runTest() {
    setBusy(true);
    const r = await api.post<{ ok: boolean; models: string[]; error?: string }>('/providers/models', { config: p });
    modelCache.delete(p.id);
    setTest(r.ok ? { ok: true, text: `Connected, ${r.models.length} model${r.models.length === 1 ? '' : 's'} available` } : { ok: false, text: r.error ?? 'Failed' });
    setBusy(false);
  }
  const set = (fn: (x: ProviderConfig) => void) => edit((d) => fn(d.providers[index]));
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Input className="!w-auto flex-1 !bg-transparent !border-transparent !px-0 font-medium !text-[15px] focus:!ring-0" value={p.name} onChange={(e) => set((x) => void (x.name = e.target.value))} />
        <Badge>{meta?.label ?? p.type}</Badge>
        {removable && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => edit((d) => void d.providers.splice(index, 1))} aria-label="Remove provider">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {p.type !== 'anthropic' && (
          <Field label="Server URL">
            <Input value={p.baseUrl ?? ''} placeholder={meta?.base} onChange={(e) => set((x) => void (x.baseUrl = e.target.value))} />
          </Field>
        )}
        {(meta?.key || p.apiKey) && (
          <Field label="API key" hint="Stored only on your server. Never sent to the browser or to the model.">
            <Input type="password" autoComplete="off" value={p.apiKey ?? ''} placeholder={p.type === 'anthropic' ? 'sk-ant-…' : 'sk-…'} onChange={(e) => set((x) => void (x.apiKey = e.target.value))} />
          </Field>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={() => void runTest()} loading={busy}>
          Test connection
        </Button>
        <AnimatePresence>
          {test && (
            <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={cx('flex items-center gap-1.5 text-xs', test.ok ? 'text-ok' : 'text-danger')}>
              {test.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} <span className="line-clamp-2">{test.text}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

function ModelsSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [adding, setAdding] = useState<ProviderConfig['type']>('openai-compatible');
  const builtin = new Set(['ollama', 'llamacpp', 'anthropic', 'openai']);
  const mainProvider = draft.providers.find((p) => p.id === draft.main.providerId);
  return (
    <>
      <Section title="Main agent" description="The model that talks with you and runs the show. A local Ollama model works well; it can hand harder jobs to sub-agents.">
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <Field label="Provider">
            <Select value={draft.main.providerId} onChange={(e) => edit((d) => void ((d.main.providerId = e.target.value), (d.main.model = '')))}>
              {draft.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Model" hint={mainProvider?.type === 'ollama' ? 'Pick one that supports tool calling, e.g. qwen3, llama3.1, mistral-nemo or gpt-oss.' : undefined}>
            <ModelPicker providerId={draft.main.providerId} value={draft.main.model} onChange={(v) => edit((d) => void (d.main.model = v))} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {(mainProvider?.type === 'anthropic' || mainProvider?.type === 'openai') && (
            <Field label="Effort">
              <Select value={draft.main.effort} onChange={(e) => edit((d) => void (d.main.effort = e.target.value as Effort))}>
                {EFFORTS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Max steps per request" hint="Safety limit on tool calls in one go.">
            <Input type="number" min={1} max={200} value={draft.main.maxSteps} onChange={(e) => edit((d) => void (d.main.maxSteps = Number(e.target.value)))} />
          </Field>
          <Field label="Messages of history" hint="Lower it for small local context windows.">
            <Input type="number" min={4} max={1000} value={draft.main.contextMessages} onChange={(e) => edit((d) => void (d.main.contextMessages = Number(e.target.value)))} />
          </Field>
        </div>
        {mainProvider?.type !== 'anthropic' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Tuning temperature={draft.main.temperature} contextLength={draft.main.contextLength} showContext={mainProvider?.type === 'ollama'} onChange={(t) => edit((d) => void Object.assign(d.main, t))} />
          </div>
        )}
      </Section>

      <Section title="Model providers" description="Local servers and cloud APIs Sable can use. Add as many as you like.">
        {draft.providers.map((p, i) => (
          <ProviderCard key={p.id} p={p} index={i} edit={edit} removable={!builtin.has(p.id)} />
        ))}
        <div className="flex gap-2">
          <Select value={adding} onChange={(e) => setAdding(e.target.value as ProviderConfig['type'])} className="!w-auto">
            {PROVIDER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Button
            onClick={() =>
              edit((d) => {
                const meta = PROVIDER_TYPES.find((t) => t.value === adding)!;
                let pid = slug(meta.label);
                while (d.providers.some((p) => p.id === pid)) pid += '-2';
                d.providers.push({ id: pid, type: adding, name: meta.label, baseUrl: meta.base ?? '', apiKey: '' });
              })
            }
          >
            <Plus className="size-4" /> Add provider
          </Button>
        </div>
        <Card className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-sm font-medium">Claude refusal fallback</div>
            <div className="text-xs text-fg-2">If a Claude model declines a request, Anthropic retries it on a fallback model automatically.</div>
          </div>
          <Toggle checked={draft.anthropic.serverFallbacks} onChange={(v) => edit((d) => void (d.anthropic.serverFallbacks = v))} />
        </Card>
      </Section>
    </>
  );
}

function AgentsSection({ draft, edit, tools }: { draft: Settings; edit: Edit; tools: ToolInfo[] }) {
  const usable = tools.filter((t) => t.name !== 'delegate');
  return (
    <Section
      title="Sub-agents"
      description="Specialists your main agent can delegate to, each with its own model and toolset. Example: a local model for chat that calls Claude for coding."
    >
      <AnimatePresence initial={false}>
        {draft.subagents.map((a, i) => {
          const set = (fn: (x: AgentProfile) => void) => edit((d) => fn(d.subagents[i]));
          return (
            <motion.div key={i} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
              <Card data-agent-card className={cx('p-4 transition-opacity', !a.enabled && 'opacity-60')}>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-panel-2 text-fg-2 border border-line">
                    <Bot className="size-4.5" />
                  </div>
                  <Input className="!w-auto flex-1 !bg-transparent !border-transparent !px-0 font-medium !text-[15px] focus:!ring-0" value={a.name} onChange={(e) => set((x) => void (x.name = e.target.value))} />
                  <code className="hidden text-xs text-fg-3 sm:block">{a.id}</code>
                  <Toggle checked={a.enabled} onChange={(v) => set((x) => void (x.enabled = v))} label="Enabled" />
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => edit((d) => void d.subagents.splice(i, 1))} aria-label="Remove">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-4 space-y-4">
                  <Field label="When to use it" hint="The main agent reads this to decide when to delegate.">
                    <Textarea className="!min-h-14" value={a.description} onChange={(e) => set((x) => void (x.description = e.target.value))} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                    <Field label="Provider">
                      <Select value={a.providerId} onChange={(e) => set((x) => void ((x.providerId = e.target.value), (x.model = '')))}>
                        {draft.providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Model">
                      <ModelPicker providerId={a.providerId} value={a.model} onChange={(v) => set((x) => void (x.model = v))} placeholder={a.providerId === draft.main.providerId ? 'Same as main agent' : undefined} />
                    </Field>
                  </div>
                  <Field label="Tools it may use">
                    <div className="flex flex-wrap gap-1.5">
                      {usable.map((t) => {
                        const on = a.tools.includes(t.name);
                        return (
                          <motion.button
                            key={t.name}
                            type="button"
                            whileTap={{ scale: 0.94 }}
                            onClick={() => set((x) => void (x.tools = on ? x.tools.filter((n) => n !== t.name) : [...x.tools, t.name]))}
                            className={cx('rounded-lg border px-2 py-1 text-xs transition-colors', on ? 'border-fg/30 bg-panel-3 text-fg' : 'border-line text-fg-2 hover:text-fg')}
                          >
                            {t.label}
                          </motion.button>
                        );
                      })}
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Max steps">
                      <Input type="number" min={1} max={100} value={a.maxSteps ?? 12} onChange={(e) => set((x) => void (x.maxSteps = Number(e.target.value)))} />
                    </Field>
                    <Field label="Effort (Claude / OpenAI)">
                      <Select value={a.effort ?? ''} onChange={(e) => set((x) => void (x.effort = e.target.value as Effort))}>
                        {EFFORTS.map((e) => (
                          <option key={e.value} value={e.value}>
                            {e.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  {draft.providers.find((p) => p.id === a.providerId)?.type !== 'anthropic' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Tuning temperature={a.temperature} contextLength={a.contextLength} showContext={draft.providers.find((p) => p.id === a.providerId)?.type === 'ollama'} onChange={(t) => set((x) => void Object.assign(x, t))} />
                    </div>
                  )}
                  <Field label="Extra instructions (optional)">
                    <Textarea className="!min-h-14" value={a.systemPrompt ?? ''} onChange={(e) => set((x) => void (x.systemPrompt = e.target.value))} />
                  </Field>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <div className="pt-2">
        <h3 className="text-sm font-semibold">Add a local specialist</h3>
        <p className="mt-0.5 text-xs text-fg-2">Purpose-built presets that run on Ollama, each with a model suggested for its job. Change anything after adding; a missing model can be downloaded from the card.</p>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {AGENT_TEMPLATES.map((t, i) => (
            <motion.button
              key={t.id}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                edit((d) => {
                  const ollama = d.providers.find((p) => p.type === 'ollama');
                  let aid = t.id;
                  let n = 2;
                  while (d.subagents.some((s) => s.id === aid)) aid = `${t.id}-${n++}`;
                  d.subagents.push({ ...structuredClone(t.profile), id: aid, providerId: ollama?.id ?? d.main.providerId, model: t.model, enabled: true });
                });
                setTimeout(() => [...document.querySelectorAll('[data-agent-card]')].pop()?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
              }}
              className="group flex items-start gap-3 rounded-lg border border-line bg-panel p-3.5 text-left transition-colors hover:border-line-strong hover:shadow-2"
            >
              {(() => {
                const Icon = TEMPLATE_ICONS[t.icon];
                return (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-fg-2">
                    <Icon className="size-4" />
                  </span>
                );
              })()}
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {t.name} <Plus className="size-3.5 text-fg-3 transition-colors group-hover:text-fg-2" />
                </span>
                <span className="mt-0.5 block text-xs text-fg-2">{t.blurb}</span>
                <code className="mt-1.5 block truncate text-[11px] text-fg-2">{t.model}</code>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        onClick={() =>
          edit((d) => {
            let aid = 'helper';
            let n = 2;
            while (d.subagents.some((s) => s.id === aid)) aid = `helper-${n++}`;
            d.subagents.push({ id: aid, name: 'Helper', description: 'Describe what this agent is good at.', providerId: d.main.providerId, model: '', tools: ['web_search', 'web_fetch'], enabled: true, maxSteps: 12 });
          })
        }
      >
        <Plus className="size-4" /> Blank sub-agent
      </Button>
    </Section>
  );
}

const POLICY_OPTIONS: { value: Policy; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Off' },
];

function PermissionsSection({ draft, edit, tools }: { draft: Settings; edit: Edit; tools: ToolInfo[] }) {
  const groups = useMemo(() => {
    const g = new Map<string, ToolInfo[]>();
    for (const t of tools) g.set(t.group, [...(g.get(t.group) ?? []), t]);
    return [...g.entries()];
  }, [tools]);
  return (
    <>
      <Section
        title="What needs your OK"
        description={
          <>
            <b>Auto</b> runs without asking, <b>Ask</b> waits for your approval, <b>Off</b> blocks the tool entirely. Every action is recorded in Activity either way.
          </>
        }
      >
        {groups.map(([group, list]) => (
          <Card key={group} className="divide-y divide-line">
            <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{group}</div>
            {list.map((t) => {
              const policy = draft.policies[t.name] ?? t.defaultPolicy;
              return (
                <div key={t.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {t.label}
                      {t.risk === 'high' && <Badge tone="accent">sensitive</Badge>}
                    </div>
                    <div className="line-clamp-1 text-xs text-fg-2">{t.description}</div>
                  </div>
                  <Segmented id={`p-${t.name}`} value={policy} options={POLICY_OPTIONS} onChange={(v) => edit((d) => void (d.policies[t.name] = v))} />
                </div>
              );
            })}
          </Card>
        ))}
      </Section>
      <Section title="Websites" description="Trusted sites can be read without asking. Blocked sites can never be contacted. One domain per line; subdomains are included.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Always allow">
            <Textarea value={draft.allowedDomains.join('\n')} placeholder="wikipedia.org" onChange={(e) => edit((d) => void (d.allowedDomains = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)))} />
          </Field>
          <Field label="Never allow">
            <Textarea value={draft.blockedDomains.join('\n')} placeholder="example-tracker.com" onChange={(e) => edit((d) => void (d.blockedDomains = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)))} />
          </Field>
        </div>
        <Field label="SearXNG URL (optional)" hint="Without it, web search uses DuckDuckGo's HTML page, which may rate-limit. A self-hosted SearXNG with the JSON format enabled is more reliable.">
          <Input value={draft.web.searxngUrl} placeholder="http://127.0.0.1:8888" onChange={(e) => edit((d) => void (d.web.searxngUrl = e.target.value))} />
        </Field>
      </Section>
      <Section title="Scripts" description="Scripts run on your server in the workspace folder, with no API keys in their environment.">
        <Card className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-sm font-medium">Allow running scripts</div>
            <div className="text-xs text-fg-2">Python, Node.js and Bash</div>
          </div>
          <Toggle checked={draft.scripts.enabled} onChange={(v) => edit((d) => void (d.scripts.enabled = v))} />
        </Card>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Timeout (s)">
            <Input type="number" value={draft.scripts.timeoutSec} onChange={(e) => edit((d) => void (d.scripts.timeoutSec = Number(e.target.value)))} />
          </Field>
          <Field label="Python">
            <Input value={draft.scripts.python} onChange={(e) => edit((d) => void (d.scripts.python = e.target.value))} />
          </Field>
          <Field label="Node">
            <Input value={draft.scripts.node} onChange={(e) => edit((d) => void (d.scripts.node = e.target.value))} />
          </Field>
          <Field label="Bash">
            <Input value={draft.scripts.bash} onChange={(e) => edit((d) => void (d.scripts.bash = e.target.value))} />
          </Field>
        </div>
      </Section>
    </>
  );
}

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

const CHANNEL_TYPES = [
  { value: 'ntfy', label: 'ntfy', placeholder: 'https://ntfy.sh/your-secret-topic', hint: 'Free push app for iOS/Android, self-hostable. Use a hard-to-guess topic name.' },
  { value: 'discord', label: 'Discord', placeholder: 'https://discord.com/api/webhooks/…', hint: 'Channel → Edit → Integrations → Webhooks → New webhook → Copy URL.' },
  { value: 'slack', label: 'Slack', placeholder: 'https://hooks.slack.com/services/…', hint: 'Create an app with Incoming Webhooks enabled and copy the webhook URL.' },
  { value: 'webhook', label: 'Generic webhook', placeholder: 'https://example.com/hooks/sable', hint: 'Receives JSON: { source, title, body, link, ts }. Optional bearer token.' },
] as const;

function ChannelsSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [tests, setTests] = useState<Record<string, { ok: boolean; error?: string } | 'busy'>>({});
  return (
    <Section title="Channels" description="Send notifications to other apps as well as this device's push. Approvals, watcher alerts, webhooks and agent messages go to every enabled channel; choose “All” to include routine run summaries too.">
      <AnimatePresence initial={false}>
        {draft.channels.map((c, i) => {
          const meta = CHANNEL_TYPES.find((t) => t.value === c.type)!;
          const set = (fn: (x: (typeof draft.channels)[number]) => void) => edit((d) => fn(d.channels[i]));
          const t = tests[c.id];
          return (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <Input className="!w-auto flex-1 !border-transparent !bg-transparent !px-0 !text-[14px] font-medium !shadow-none focus:!ring-0" value={c.name} onChange={(e) => set((x) => void (x.name = e.target.value))} />
                  <Badge tone="outline">{meta.label}</Badge>
                  <Toggle size="sm" checked={c.enabled} onChange={(v) => set((x) => void (x.enabled = v))} />
                  <IconBtn onClick={() => edit((d) => void d.channels.splice(i, 1))} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px]">
                  <Field label="URL" hint={meta.hint}>
                    <Input value={c.url} placeholder={meta.placeholder} onChange={(e) => set((x) => void (x.url = e.target.value))} />
                  </Field>
                  <Field label="Send">
                    <Select value={c.events} onChange={(e) => set((x) => void (x.events = e.target.value as 'all' | 'important'))}>
                      <option value="important">Important</option>
                      <option value="all">All</option>
                    </Select>
                  </Field>
                </div>
                {(c.type === 'ntfy' || c.type === 'webhook') && (
                  <div className="mt-3">
                    <Field label="Access token (optional)">
                      <Input type="password" autoComplete="off" value={c.token ?? ''} onChange={(e) => set((x) => void (x.token = e.target.value))} />
                    </Field>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    size="sm"
                    loading={t === 'busy'}
                    disabled={!c.url}
                    onClick={async () => {
                      setTests((x) => ({ ...x, [c.id]: 'busy' }));
                      const r = await api.post<{ ok: boolean; error?: string }>('/channels/test', c);
                      setTests((x) => ({ ...x, [c.id]: r }));
                    }}
                  >
                    Send test
                  </Button>
                  {t && t !== 'busy' && <span className={cx('text-xs', t.ok ? 'text-ok' : 'text-danger')}>{t.ok ? 'Delivered' : t.error}</span>}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <div className="flex flex-wrap gap-1.5">
        {CHANNEL_TYPES.map((t) => (
          <Button
            key={t.value}
            size="sm"
            onClick={() =>
              edit((d) => {
                let cid = t.value as string;
                let n = 2;
                while (d.channels.some((c) => c.id === cid)) cid = `${t.value}-${n++}`;
                d.channels.push({ id: cid, name: t.label, type: t.value, url: '', enabled: true, events: 'important' });
              })
            }
          >
            <Plus className="size-3.5" /> {t.label}
          </Button>
        ))}
      </div>
    </Section>
  );
}

function IconBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Remove" className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger">
      <Trash2 className="size-3.5" />
    </button>
  );
}

function NotificationsSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [state, setState] = useState<string>('…');
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const refresh = () => void pushState().then(setState);
  useEffect(refresh, []);
  return (
    <>
    <Section title="Push notifications" description="Get notified on this device when Sable needs your approval or finishes background work.">
      <Card className="p-4">
        {state === 'insecure' && (
          <p className="text-sm text-fg-2">
            Push needs HTTPS (or localhost). Put Sable behind HTTPS, for example with <code>tailscale serve</code> or Caddy. See the README.
          </p>
        )}
        {state === 'unsupported' && <p className="text-sm text-fg-2">This browser doesn't support web push. On iPhone, add Sable to your Home Screen first (Share → Add to Home Screen).</p>}
        {state === 'denied' && <p className="text-sm text-fg-2">Notifications are blocked for this site in your browser settings.</p>}
        {(state === 'on' || state === 'off') && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 text-sm">{state === 'on' ? 'On for this device' : 'Off for this device'}</div>
            {state === 'on' && (
              <Button size="sm" variant="ghost" onClick={() => void api.post('/push/test')}>
                Send test
              </Button>
            )}
            <Button
              size="sm"
              variant={state === 'on' ? 'secondary' : 'primary'}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (state === 'on') await disablePush();
                  else await enablePush();
                } catch (err) {
                  toast({ title: 'Notifications', body: (err as Error).message, tone: 'error' });
                }
                setBusy(false);
                refresh();
              }}
            >
              {state === 'on' ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
        )}
      </Card>
    </Section>
    <ChannelsSection draft={draft} edit={edit} />
    </>
  );
}

// ───────────────────────── Page ─────────────────────────

export function SettingsView({ section }: { section?: string }) {
  const saved = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<Settings | null>(saved ? structuredClone(saved) : null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const active = (SECTIONS.find((s) => s.id === section)?.id ?? 'general') as SectionId;

  useEffect(() => {
    void api.get<ToolInfo[]>('/tools').then(setTools);
    return onServerEvent((ev) => ev.type === 'mcp.changed' && void api.get<ToolInfo[]>('/tools').then(setTools));
  }, []);
  // Pick up changes made elsewhere (e.g. "always allow" from an approval) when there are no local edits.
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    if (saved && !dirty) setDraft(structuredClone(saved));
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit: Edit = (fn) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  async function save(override?: Settings, quiet = false): Promise<Settings | null> {
    const body = override ?? draft;
    if (!body) return null;
    setSaving(true);
    try {
      const next = await api.put<Settings>('/settings', body);
      modelCache.clear();
      setSettings(next);
      setDraft(structuredClone(next));
      if (!quiet) toast({ title: 'Settings saved', tone: 'success' });
      return next;
    } catch (err) {
      toast({ title: 'Could not save', body: (err as Error).message, tone: 'error' });
      return null;
    } finally {
      setSaving(false);
    }
  }

  if (!draft)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <>
    <TopBar crumbs="Settings" title={SECTIONS.find((s) => s.id === active)?.label ?? 'Settings'} />
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <div className="flex flex-col gap-6 md:flex-row md:gap-12">
          <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:sticky md:top-0 md:mx-0 md:w-44 md:shrink-0 md:flex-col md:self-start md:px-0">
            <div className="mb-2 hidden px-2 text-[11px] font-medium text-fg-3 md:block">Settings</div>
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => navigate(`/settings/${s.id}`, { replace: true })} className={cx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', active === s.id ? 'text-fg' : 'text-fg-2 hover:text-fg')}>
                {active === s.id && <motion.span layoutId="settings-active" className="absolute inset-0 rounded-md border border-line bg-panel shadow-1" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />}
                <s.icon className="relative size-[15px]" strokeWidth={1.8} />
                <span className="relative">{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 pb-24">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.16 }}>
                {active === 'general' && <GeneralSection draft={draft} edit={edit} />}
                {active === 'models' && <ModelsSection draft={draft} edit={edit} />}
                {active === 'agents' && <AgentsSection draft={draft} edit={edit} tools={tools} />}
                {active === 'permissions' && <PermissionsSection draft={draft} edit={edit} tools={tools} />}
                {active === 'connectors' && <ConnectorsSection draft={draft} edit={edit} tools={tools} saveNow={(next) => save(next, true)} />}
                {active === 'shopping' && <ShoppingSection draft={draft} edit={edit} />}
                {active === 'network' && <NetworkSection draft={draft} edit={edit} />}
                {active === 'notifications' && <NotificationsSection draft={draft} edit={edit} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 32 }} className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-3 rounded-lg border border-line bg-panel/95 p-2 pl-4 shadow-soft backdrop-blur-xl">
            <span className="text-sm text-fg-2">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => saved && setDraft(structuredClone(saved))}>
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
}
