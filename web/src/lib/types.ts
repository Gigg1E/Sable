export type Policy = 'auto' | 'ask' | 'deny';
export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProviderConfig {
  id: string;
  type: 'ollama' | 'llamacpp' | 'openai' | 'openai-compatible' | 'anthropic';
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
  tools: string[];
  enabled: boolean;
  maxSteps?: number;
  effort?: Effort;
  temperature?: number | null;
  contextLength?: number | null;
}
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
  auth?: 'headers' | 'oauth';
  oauth?: { clientId?: string; clientSecret?: string; scope?: string };
  preset?: string;
}
export interface CalendarFeed {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface Channel {
  id: string;
  name: string;
  type: 'ntfy' | 'discord' | 'slack' | 'webhook';
  url: string;
  token?: string;
  enabled: boolean;
  events: 'all' | 'important' | 'none';
}

export type ExtractSpec =
  | { kind: 'price' }
  | { kind: 'selector'; selector: string; attribute?: string }
  | { kind: 'json'; path: string }
  | { kind: 'regex'; pattern: string }
  | { kind: 'text'; selector?: string }
  | { kind: 'ai'; instruction: string };
export type Condition = { kind: 'changed' } | { kind: 'below' | 'above' | 'drop_percent' | 'rise_percent'; value: number } | { kind: 'contains' | 'not_contains'; value: string };

export interface Watcher {
  id: string;
  title: string;
  url: string;
  source?: 'web' | 'email' | 'calendar';
  sourceLabel?: string;
  autonomy?: 'auto' | 'ask' | null;
  extract: ExtractSpec;
  condition: Condition;
  conditionLabel: string;
  actions: { notify: boolean; prompt?: string; webhook?: string };
  interval_min: number;
  enabled: boolean;
  last_value: string | null;
  last_numeric: number | null;
  last_checked: number | null;
  last_changed: number | null;
  last_triggered: number | null;
  last_error: string | null;
  fail_count: number;
  next_check: number | null;
  conversation_id: string | null;
  created_at: number;
  spark: { ts: number; numeric: number | null; triggered: number }[];
}
export interface WatchPoint {
  ts: number;
  value: string;
  numeric: number | null;
  triggered: number;
}
export interface Hook {
  id: string;
  name: string;
  verify: 'none' | 'github' | 'hmac-sha256';
  action: { notify: boolean; title?: string; prompt?: string };
  enabled: boolean;
  last_received: number | null;
  count: number;
  conversation_id: string | null;
  created_at: number;
  path: string;
  url: string;
  hasSecret: boolean;
  secret?: string;
}
export interface HookEvent {
  id: string;
  ts: number;
  method: string;
  headers: string;
  body: string;
  delivery_id: string | null;
  status: 'accepted' | 'rejected' | 'error';
  detail: string;
}

export interface Settings {
  persona: { name: string; style: string; about: string };
  providers: ProviderConfig[];
  main: { providerId: string; model: string; maxSteps: number; contextMessages: number; effort: Effort; temperature?: number | null; contextLength?: number | null };
  subagents: AgentProfile[];
  policies: Record<string, Policy>;
  allowedDomains: string[];
  blockedDomains: string[];
  web: { searxngUrl: string };
  scripts: { enabled: boolean; timeoutSec: number; python: string; node: string; bash: string };
  mcpServers: McpServerConfig[];
  anthropic: { serverFallbacks: boolean };
  channels: Channel[];
  calendars: CalendarFeed[];
  email: { accounts: EmailAccount[] };
  helpers?: { enabled: boolean; embedModel: string };
  google?: { clientId: string; clientSecret: string };
  publicUrl: string;
  shopping: { enabled: boolean; purchases: boolean; maxOrder: number; country: string; currency: string; clientId?: string; clientSecret?: string };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;
  label?: string;
}
export interface Message {
  id: string;
  conversation_id: string;
  run_id: string | null;
  role: 'user' | 'assistant' | 'tool' | 'error';
  agent: string | null;
  content: string;
  thinking: string | null;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  is_error: boolean;
  attachments?: AttachmentInfo[];
  cards?: AnyCard[];
  created_at: number;
}
export interface Conversation {
  id: string;
  title: string;
  kind: string;
  created_at: number;
  updated_at: number;
  preview?: string | null;
  running?: boolean;
  pinned?: boolean;
}
export interface Approval {
  id: string;
  run_id: string;
  conversation_id: string;
  call_id: string | null;
  agent: string;
  tool: string;
  toolLabel?: string;
  args: Record<string, unknown>;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  scope: { kind: 'domain'; value: string } | null;
  preview?: CommerceCard | AutomationCard | ConnectionCard | null;
  alwaysAsk?: boolean;
  status: string;
  created_at: number;
}
export interface ToolState {
  callId: string;
  parentCallId?: string;
  conversationId: string;
  name: string;
  label: string;
  summary: string;
  agent: string;
  args?: Record<string, unknown>;
  status: 'running' | 'waiting' | 'ok' | 'error' | 'denied' | 'blocked';
  progress: string;
  preview?: string;
  started: number;
  ended?: number;
}
export interface GoalStep {
  text: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
  note?: string;
}
export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: 'active' | 'done' | 'blocked' | 'cancelled';
  steps: GoalStep[];
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
}
export interface SpaceSummary {
  id: string;
  title: string;
  description: string;
  icon: string;
  pinned: boolean;
  updated_at: number;
}
export interface Space extends SpaceSummary {
  html: string;
  data: Record<string, unknown>;
}
export interface Memory {
  id: string;
  content: string;
  kind?: 'me' | 'other' | 'howto';
  source: string | null;
  created_at: number;
  updated_at: number;
}
export interface ActivityItem {
  id: string;
  ts: number;
  conversation_id: string | null;
  run_id: string | null;
  agent: string;
  tool: string;
  status: string;
  summary: string;
  input: string;
  output: string;
  duration_ms: number | null;
}
export interface Schedule {
  id: string;
  title: string;
  prompt: string;
  kind: 'once' | 'interval' | 'daily' | 'weekly';
  spec: { at?: string; every_minutes?: number; time?: string; weekday?: number };
  next_run: number | null;
  last_run: number | null;
  enabled: boolean;
  conversation_id: string | null;
  /** Notify on every run, or only when the check finds something new. */
  notify?: 'always' | 'when_new';
  /** 'auto': its runs act without asking (except purchases and `restrict`). */
  autonomy?: 'auto' | 'ask';
  restrict?: string[];
}
export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string;
  kind: string;
  read: number;
  created_at: number;
}
export interface ToolInfo {
  name: string;
  label: string;
  group: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  source: 'builtin' | 'mcp';
  defaultPolicy: Policy;
  policy: Policy;
}

export interface Money {
  amount: number;
  currency: string;
}
export interface OfferCard {
  variantId: string;
  productId: string;
  title: string;
  options: string;
  price: Money | null;
  available: boolean | null;
  image: string | null;
  url: string | null;
  seller: { name: string; domain: string; url?: string };
  rating: { value: number; count: number } | null;
  fetchedAt: number;
}
export interface CartLikeCard {
  type: 'cart' | 'checkout' | 'order';
  id: string;
  shop: string;
  seller: string;
  status: string | null;
  currency: string;
  lines: { variantId: string; title: string; image: string | null; quantity: number; unitPrice: Money | null; total: Money | null }[];
  totals: { type: string; label: string; amount: number }[];
  address: string | null;
  shipping: { title: string; amount: number | null } | null;
  instruments: { id: string | null; label: string; selected: boolean }[];
  messages: { type: string; code: string; text: string }[];
  links: { title: string; url: string }[];
  continueUrl: string | null;
  order: { id: string; number: string | null; url: string | null } | null;
  fetchedAt: number;
  confirm?: boolean;
  payWith?: { label: string };
  handoffReason?: string;
}
export type CommerceCard = { type: 'products'; heading: string | null; items: OfferCard[]; source: string } | CartLikeCard;

export interface AttachmentInfo {
  id: string;
  kind?: 'image' | 'file';
  mime: string;
  name?: string;
  size?: number;
  width: number | null;
  height: number | null;
  path?: string | null;
}

export interface FileCardData {
  type: 'file';
  path: string;
  name: string;
  size: number;
  mime: string;
  kind: 'text' | 'image' | 'other';
  updated: number;
}
export interface LinkItem {
  url: string;
  site: string;
  title: string;
  description?: string;
  image?: string;
  price?: string;
  note?: string;
  ok: boolean;
}
export interface LinksCardData {
  type: 'links';
  title?: string;
  items: LinkItem[];
}
export interface ImagesCardData {
  type: 'images';
  items: { url: string; caption?: string; source?: string; site: string }[];
}
export type AnyCard = CommerceCard | FileCardData | LinksCardData | ImagesCardData | CredentialCardData | import('../components/GraphCard').GraphCardData;

/** Shown when the agent proposes a routine or watcher, before it exists. */
export interface AutomationCard {
  type: 'automation';
  kind: 'routine' | 'watcher';
  title: string;
  when: string;
  next?: number;
  prompt: string;
  notify?: 'always' | 'when_new';
  restrict: string[];
  source?: string;
}

export interface EmailAccount {
  id: string;
  name: string;
  address: string;
  provider: 'gmail' | 'icloud' | 'yahoo' | 'outlook' | 'custom';
  user?: string;
  password: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  isDefault?: boolean;
  enabled?: boolean;
}

export interface ConnectionInfo {
  name: string;
  baseUrl: string;
  host: string;
  auth: { style: 'bearer' | 'header' | 'query' | 'basic' | 'aws-sigv4' | 'none'; header?: string; param?: string; region?: string; service?: string };
  readMethods: string[];
  purpose: string;
  credentialHelp: string;
  hasSecret: boolean;
  createdAt: number;
  lastUsed: number | null;
}
export interface ConnectionCard {
  type: 'connection';
  name: string;
  baseUrl: string;
  auth: ConnectionInfo['auth'];
  readMethods: string[];
  purpose: string;
  credentialHelp: string;
  docsUrl?: string;
  change: boolean;
  dropsCredential: boolean;
}
export interface CredentialCardData {
  type: 'credential';
  name: string;
  host: string;
  style: string;
  help: string;
}
