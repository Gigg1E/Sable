import { kvGet, kvSet } from './db.js';

export type ProviderType = 'ollama' | 'llamacpp' | 'openai' | 'openai-compatible' | 'anthropic';

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  providerId: string;
  model: string;
  systemPrompt?: string;
  /** Tool names this sub-agent may use. */
  tools: string[];
  enabled: boolean;
  maxSteps?: number;
  effort?: Effort;
  /** Sampling temperature (local / OpenAI-compatible models). Empty = model default. */
  temperature?: number | null;
  /** Ollama context window (num_ctx). Empty = model default. */
  contextLength?: number | null;
}

export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Policy = 'auto' | 'ask' | 'deny';

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** How a remote server authenticates: static headers, or "Connect account" via OAuth. */
  auth?: 'headers' | 'oauth';
  /** Optional pre-registered OAuth client (needed by providers without dynamic registration, e.g. Google). */
  oauth?: { clientId?: string; clientSecret?: string; scope?: string };
  /** Gallery preset this connector was created from. */
  preset?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: 'ntfy' | 'discord' | 'slack' | 'webhook';
  url: string;
  /** ntfy access token, or a bearer token for generic webhooks. */
  token?: string;
  enabled: boolean;
  /** Which notifications go to this channel. */
  /** all / important: also gets notifications. none: only when the agent or an automation sends to it. */
  events: 'all' | 'important' | 'none';
}

/** A mailbox reached over IMAP/SMTP with an app password. */
export interface EmailAccount {
  id: string;
  name: string;
  address: string;
  provider: 'gmail' | 'icloud' | 'yahoo' | 'outlook' | 'custom' | 'google';
  /** Login name if it isn't the address. */
  user?: string;
  /** App password (secret). */
  password: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  isDefault?: boolean;
  enabled?: boolean;
}

/** A read-only calendar subscription (iCal / ICS "secret address"). */
export interface CalendarFeed {
  id: string;
  name: string;
  /** Secret: anyone with this address can read the calendar. */
  url: string;
  enabled: boolean;
}

export interface Settings {
  persona: { name: string; style: string; about: string };
  providers: ProviderConfig[];
  main: { providerId: string; model: string; maxSteps: number; contextMessages: number; effort: Effort; temperature?: number | null; contextLength?: number | null };
  subagents: AgentProfile[];
  /** Per-tool approval policy. Tools not listed fall back to their own default. */
  policies: Record<string, Policy>;
  allowedDomains: string[];
  blockedDomains: string[];
  web: { searxngUrl: string };
  scripts: { enabled: boolean; timeoutSec: number; python: string; node: string; bash: string };
  mcpServers: McpServerConfig[];
  anthropic: { serverFallbacks: boolean };
  /** Outbound notification channels (ntfy, Discord, Slack, generic webhooks). */
  channels: Channel[];
  /** Read-only calendar feeds the agent can read. */
  calendars: CalendarFeed[];
  /** Mailboxes the agent can read, watch and send from. */
  email: { accounts: EmailAccount[] };
  /** The user's own Google OAuth client, for "Sign in with Google" (Gmail + Calendar). */
  google: { clientId: string; clientSecret: string };
  /** Small local model that picks relevant tools and memories (installed in Ollama automatically). */
  helpers: { enabled: boolean; embedModel: string };
  /** Public base URL of this Sable server, used to build inbound webhook URLs. */
  publicUrl: string;
  shopping: {
    /** Shop catalog tools available to the agent. */
    enabled: boolean;
    /** Master switch for completing purchases (each one still needs approval). */
    purchases: boolean;
    /** Largest order total allowed, in major units of `currency`. */
    maxOrder: number;
    country: string;
    currency: string;
    /** Optional own Shop app client (Dev Dashboard) instead of Shop's public device-flow client. */
    clientId?: string;
    clientSecret?: string;
  };
}

const env = process.env;

export function defaultSettings(): Settings {
  return {
    persona: {
      name: 'Sable',
      style: 'Warm, direct and concise. Skip filler. Use Markdown when it helps.',
      about: '',
    },
    providers: [
      { id: 'ollama', type: 'ollama', name: 'Ollama', baseUrl: env.OLLAMA_HOST ?? 'http://127.0.0.1:11434' },
      { id: 'llamacpp', type: 'llamacpp', name: 'llama.cpp', baseUrl: env.LLAMACPP_URL ?? 'http://127.0.0.1:8080/v1' },
      { id: 'anthropic', type: 'anthropic', name: 'Claude', apiKey: env.ANTHROPIC_API_KEY ?? '' },
      { id: 'openai', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY ?? '' },
    ],
    main: {
      providerId: 'ollama',
      model: env.SABLE_MODEL ?? '',
      maxSteps: 24,
      contextMessages: 80,
      effort: '',
      temperature: null,
      contextLength: null,
    },
    subagents: [
      {
        id: 'coder',
        name: 'Coder',
        description:
          'Writes, runs and debugs scripts (Python, Node, Bash) and edits files in the workspace. Use for programming, data wrangling and automation.',
        providerId: 'anthropic',
        model: 'claude-opus-5-5',
        tools: ['file_list', 'file_read', 'file_write', 'file_edit', 'show_file', 'run_script'],
        enabled: true,
        maxSteps: 16,
        effort: 'medium',
      },
      {
        id: 'researcher',
        name: 'Researcher',
        description: 'Searches the web, reads pages and returns a sourced summary. Use for questions that need fresh information.',
        providerId: 'ollama',
        model: '',
        tools: ['web_search', 'web_fetch', 'memory_search'],
        enabled: true,
        maxSteps: 12,
      },
    ],
    policies: {},
    allowedDomains: [],
    blockedDomains: [],
    web: { searxngUrl: env.SEARXNG_URL ?? '' },
    scripts: { enabled: true, timeoutSec: 60, python: 'python3', node: 'node', bash: 'bash' },
    mcpServers: [],
    anthropic: { serverFallbacks: true },
    channels: [],
    calendars: [],
    email: { accounts: [] },
    helpers: { enabled: true, embedModel: 'embeddinggemma' },
    google: { clientId: '', clientSecret: '' },
    publicUrl: env.SABLE_PUBLIC_URL ?? '',
    shopping: { enabled: true, purchases: false, maxOrder: 200, country: 'US', currency: 'USD' },
  };
}

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  const stored = kvGet<Partial<Settings>>('settings');
  const defaults = defaultSettings();
  cache = stored ? merge(defaults, stored) : defaults;
  if (!stored) kvSet('settings', cache);
  return cache;
}

function merge(defaults: Settings, stored: Partial<Settings>): Settings {
  const out = { ...defaults, ...stored } as Settings;
  for (const key of ['persona', 'main', 'web', 'scripts', 'anthropic', 'shopping', 'email', 'helpers', 'google'] as const) {
    (out as any)[key] = { ...(defaults as any)[key], ...((stored as any)[key] ?? {}) };
  }
  return out;
}

const MASK = '••••••••';

/** Webhook URLs embed their secret (Discord/Slack), so only show the host. */
function maskUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.pathname.length <= 1 && !u.search) return url;
    // ntfy topics are the secret; Discord/Slack paths contain tokens.
    return `${u.protocol}//${u.host}/${MASK}`;
  } catch {
    return MASK;
  }
}

/** Settings safe to send to the browser: API keys never leave the server. */
export function publicSettings(): Settings {
  const s = structuredClone(getSettings());
  for (const p of s.providers) p.apiKey = p.apiKey ? MASK + p.apiKey.slice(-4) : '';
  for (const c of s.channels ?? []) {
    c.token = c.token ? MASK : '';
    c.url = maskUrl(c.url);
  }
  for (const c of s.calendars ?? []) c.url = maskUrl(c.url);
  for (const a of s.email?.accounts ?? []) a.password = a.password ? MASK : '';
  for (const m of s.mcpServers) {
    if (m.env) for (const k of Object.keys(m.env)) m.env[k] = m.env[k] ? MASK : '';
    if (m.headers) for (const k of Object.keys(m.headers)) m.headers[k] = m.headers[k] ? MASK : '';
    if (m.oauth?.clientSecret) m.oauth.clientSecret = MASK;
  }
  if (s.shopping?.clientSecret) s.shopping.clientSecret = MASK;
  if (s.google?.clientSecret) s.google.clientSecret = MASK;
  return s;
}

/** Apply an update coming from the browser, keeping secrets that came back masked. */
export function updateSettings(next: Settings): Settings {
  const prev = getSettings();
  for (const p of next.providers ?? []) {
    if (p.apiKey?.startsWith(MASK)) p.apiKey = prev.providers.find((x) => x.id === p.id)?.apiKey ?? '';
  }
  if (next.shopping?.clientSecret === MASK) next.shopping.clientSecret = prev.shopping.clientSecret ?? '';
  if (next.google?.clientSecret === MASK) next.google.clientSecret = prev.google?.clientSecret ?? '';
  for (const c of next.channels ?? []) {
    const old = prev.channels.find((x) => x.id === c.id);
    if (c.token === MASK) c.token = old?.token ?? '';
    if (c.url?.includes(MASK)) c.url = old?.url ?? '';
  }
  for (const a of next.email?.accounts ?? []) {
    if (a.password === MASK) a.password = prev.email?.accounts?.find((x) => x.id === a.id)?.password ?? '';
  }
  for (const c of next.calendars ?? []) {
    if (c.url?.includes(MASK)) c.url = prev.calendars?.find((x) => x.id === c.id)?.url ?? '';
  }
  for (const m of next.mcpServers ?? []) {
    const old = prev.mcpServers.find((x) => x.id === m.id);
    if (m.oauth?.clientSecret === MASK) m.oauth.clientSecret = old?.oauth?.clientSecret ?? '';
    for (const field of ['env', 'headers'] as const) {
      const rec = m[field];
      if (!rec) continue;
      for (const k of Object.keys(rec)) if (rec[k] === MASK) rec[k] = old?.[field]?.[k] ?? '';
    }
  }
  cache = merge(defaultSettings(), next);
  kvSet('settings', cache);
  return cache;
}

export function getProvider(id: string): ProviderConfig | undefined {
  return getSettings().providers.find((p) => p.id === id);
}
