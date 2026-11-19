import { callConnection, getConnection, listConnections, normalizeDefinition, removeConnection, saveConnection, type ConnectionAuth } from '../../connections.js';
import { emit } from '../../events.js';
import { errorMessage, untrusted } from '../../util.js';
import { registerTool, type Card } from './registry.js';
import type { JsonSchema } from '../../llm/types.js';

/**
 * Tools for self-built connections. The model only ever knows a connection's name; credentials
 * are added by the runtime. Reads run freely; anything that changes something asks the user.
 */

const authSchema = {
  type: 'object',
  description:
    'How the API authenticates. bearer: Authorization: Bearer <token>. header: a custom header (give header, e.g. "X-Api-Key"). query: ?param=<key> (give param). basic: username:password. aws-sigv4: AWS request signing (give region and service, e.g. us-east-1 / ce). none: public API.',
  properties: {
    style: { type: 'string', enum: ['bearer', 'header', 'query', 'basic', 'aws-sigv4', 'none'] },
    header: { type: 'string' },
    param: { type: 'string' },
    region: { type: 'string' },
    service: { type: 'string' },
  },
  required: ['style'],
};

registerTool({
  name: 'connect_define',
  label: 'Define connection',
  group: 'Connections',
  description:
    "Create (or change) a connection to an account or API the user wants you to use and you have no tool for: AWS, GitHub, Cloudflare, Stripe, a router, Home Assistant… FIRST research the official API docs with web_search/web_fetch to get the real base URL and auth style; never guess from memory. read_methods are the HTTP methods that only read (default GET, HEAD; add POST only for APIs that read via POST, like AWS JSON APIs or GraphQL). In credential_help, tell the user exactly what credential to create with the least privilege (e.g. \"an IAM user with only ce:GetCostAndUsage; enter it as ACCESS_KEY_ID:SECRET_ACCESS_KEY\"). The user approves the definition, then enters the credential in a secure field you never see. Some services (e.g. Amazon shopping orders) have no API for personal accounts: tell the user instead of inventing one.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short lowercase id, e.g. "aws", "github", "homeassistant"' },
      base_url: { type: 'string', description: 'https base URL from the official docs' },
      auth: authSchema,
      read_methods: { type: 'array', items: { type: 'string' } },
      purpose: { type: 'string', description: 'What it is for, e.g. "read AWS costs"' },
      credential_help: { type: 'string', description: 'Exactly what credential to create (least privilege) and the format to enter it in' },
      docs_url: { type: 'string', description: 'The documentation page you used' },
    },
    required: ['name', 'base_url', 'auth', 'purpose'],
  },
  risk: 'high',
  defaultPolicy: 'ask',
  alwaysAsk: true,
  async preview(a) {
    let d;
    try {
      d = normalizeDefinition({ name: a.name, base_url: a.base_url, auth: a.auth as ConnectionAuth, read_methods: a.read_methods, purpose: a.purpose, credential_help: a.credential_help });
    } catch (err) {
      return { refuse: errorMessage(err) };
    }
    const existing = getConnection(d.name);
    return {
      summary: `${existing ? 'Change' : 'Create'} connection “${d.name}”`,
      card: {
        type: 'connection', name: d.name, baseUrl: d.baseUrl, auth: d.auth, readMethods: d.readMethods, purpose: d.purpose, credentialHelp: d.credentialHelp,
        docsUrl: typeof a.docs_url === 'string' ? a.docs_url : undefined, change: !!existing,
        dropsCredential: !!existing && existing.hasSecret && (existing.host !== new URL(d.baseUrl).host || JSON.stringify(existing.auth) !== JSON.stringify(d.auth)),
      },
    };
  },
  summarize: (a) => `Connection “${a.name}” → ${a.base_url}`,
  async run(a) {
    const d = normalizeDefinition({ name: a.name, base_url: a.base_url, auth: a.auth as ConnectionAuth, read_methods: a.read_methods, purpose: a.purpose, credential_help: a.credential_help });
    saveConnection(d);
    emit({ type: 'connections.changed' });
    const c = getConnection(d.name)!;
    const needsKey = c.auth.style !== 'none' && !c.hasSecret;
    const cards: Card[] = needsKey ? [{ type: 'credential', name: c.name, host: c.host, style: c.auth.style, help: c.credentialHelp }] : [];
    return {
      content: `Connection "${c.name}" saved (${c.host}). ${needsKey ? `It needs a credential: the user enters it in the secure field shown in the chat (or Settings → Connectors → Connections). Tell them what to create: ${c.credentialHelp || 'the API key for this service'}. Never ask them to paste it into the chat.` : 'Ready to use with connect_read / connect_write.'}`,
      cards,
    };
  },
});

registerTool({
  name: 'connect_list',
  label: 'List connections',
  group: 'Connections',
  description: 'List the connections you built (name, host, auth style, read methods, whether a credential is set).',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const list = listConnections();
    if (!list.length) return 'No connections yet. Research an API and create one with connect_define.';
    return list.map((c) => `- ${c.name}: ${c.baseUrl} · ${c.auth.style} · reads ${c.readMethods.join('/')} · ${c.hasSecret || c.auth.style === 'none' ? 'ready' : 'NO CREDENTIAL YET'} · ${c.purpose}`).join('\n');
  },
});

const callParams: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Connection name' },
    path: { type: 'string', description: 'Path relative to the base URL, e.g. "/user/repos"' },
    method: { type: 'string' },
    query: { type: 'object', description: 'Query parameters' },
    json_body: { description: 'JSON request body' },
    headers: { type: 'object', description: 'Extra headers (never auth: the runtime adds it)' },
  },
  required: ['name'],
};

async function doCall(a: Record<string, any>, signal?: AbortSignal) {
  try {
    const r = await callConnection(String(a.name), { path: a.path, method: a.method, query: a.query, json_body: a.json_body, headers: a.headers }, signal);
    return untrusted(`${a.name} API`, `HTTP ${r.status}${r.contentType ? ` · ${r.contentType.split(';')[0]}` : ''}\n\n${r.body}`);
  } catch (err) {
    if (signal?.aborted) throw err;
    return `Error: ${errorMessage(err)}`;
  }
}

registerTool({
  name: 'connect_read',
  label: 'Read via connection',
  group: 'Connections',
  description: "Call one of your connections with a method it lists as a read (usually GET). Runs without asking. The credential is added for you; you only give the connection's name.",
  parameters: callParams,
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `${String(a.method ?? 'GET').toUpperCase()} ${a.name}${a.path ?? '/'}`,
  async run(a, ctx) {
    const c = getConnection(String(a.name));
    const method = String(a.method ?? 'GET').toUpperCase();
    if (c && !c.readMethods.includes(method)) return `${method} isn't a read method for "${c.name}" (reads: ${c.readMethods.join(', ')}). Use connect_write for changes; the user will be asked.`;
    return doCall(a, ctx.signal);
  },
});

registerTool({
  name: 'connect_write',
  label: 'Change via connection',
  group: 'Connections',
  description: "Call one of your connections with a method that changes something in the user's account (POST, PUT, PATCH, DELETE). The user approves each call.",
  parameters: callParams,
  risk: 'high',
  defaultPolicy: 'ask',
  summarize: (a) => `${String(a.method ?? 'POST').toUpperCase()} ${a.name}${a.path ?? '/'}`,
  async run(a, ctx) {
    return doCall({ ...a, method: a.method ?? 'POST' }, ctx.signal);
  },
});

registerTool({
  name: 'connect_remove',
  label: 'Remove connection',
  group: 'Connections',
  description: 'Delete a connection and its stored credential.',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Remove connection “${a.name}”`,
  async run(a) {
    const ok = removeConnection(String(a.name));
    emit({ type: 'connections.changed' });
    return ok ? `Removed "${a.name}" and its credential.` : 'No such connection.';
  },
});
