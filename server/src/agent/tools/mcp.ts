import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { oauthInfo, prepareRedirect, SableOAuthProvider } from './mcpAuth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { WORKSPACE_DIR } from '../../config.js';
import { emit } from '../../events.js';
import { proxyEnv } from '../../net.js';
import { getSettings, type McpServerConfig } from '../../settings.js';
import { errorMessage, truncate, untrusted } from '../../util.js';
import { registerTool, unregisterWhere } from './registry.js';

/**
 * Connectors: any Model Context Protocol server (Gmail, Calendar, GitHub, Home Assistant, Notion…)
 * becomes a set of tools. Every connector tool asks for approval by default — the user widens
 * access per tool in Settings → Permissions, and can disconnect a connector at any time.
 */

export interface McpStatus {
  id: string;
  name: string;
  state: 'connected' | 'error' | 'disabled' | 'connecting' | 'needs_auth';
  error?: string;
  /** Where to send the browser to sign in (OAuth connectors). */
  authUrl?: string;
  oauth?: boolean;
  tools: string[];
}

const clients = new Map<string, Client>();
const status = new Map<string, McpStatus>();

export function mcpStatus(): McpStatus[] {
  return getSettings().mcpServers.map(
    (s) => status.get(s.id) ?? { id: s.id, name: s.name, state: s.enabled ? 'connecting' : 'disabled', tools: [] },
  );
}

/**
 * Some hosted servers answer a request successfully but with a non-2xx HTTP status, which the SDK
 * treats as a failure and reports with the whole body. If the body is a valid JSON-RPC success,
 * pass it on as a normal 200 response.
 */
const lenientFetch = (serverName: string): typeof fetch => async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok || res.status === 401 || !/json/i.test(res.headers.get('content-type') ?? '')) return res;
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    const msgs = Array.isArray(data) ? data : [data];
    if (msgs.length && msgs.every((m) => m && m.jsonrpc === '2.0' && 'result' in m && !('error' in m))) {
      console.warn(`[mcp] ${serverName}: HTTP ${res.status} with a successful reply; treating as 200`);
      return new Response(text, { status: 200, headers: res.headers });
    }
  } catch {
    /* not JSON */
  }
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
};

/** Connector errors can embed a whole response body. Keep what a person needs; log the rest. */
export function shortMcpError(serverName: string, err: unknown): string {
  const full = errorMessage(err);
  if (full.length <= 300) return full;
  console.warn(`[mcp] ${serverName}: ${full}`);
  const status = (err as { code?: number }).code;
  let detail = '';
  const json = full.slice(full.indexOf('{'));
  try {
    const d = JSON.parse(json);
    detail = d?.error?.message ?? d?.error?.status ?? (d?.result ? 'the server sent a normal reply with an error status' : '');
  } catch {
    detail = full.replace(/\s+/g, ' ').slice(0, 200) + '…';
  }
  return `${serverName} returned an error${typeof status === 'number' && status > 0 ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}. Full details are in the server log.`;
}

function toolName(serverId: string, name: string) {
  return `mcp_${serverId}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

async function connect(cfg: McpServerConfig) {
  status.set(cfg.id, { id: cfg.id, name: cfg.name, state: 'connecting', tools: [] });
  let transport: Transport;
  if (cfg.transport === 'http') {
    if (!cfg.url) throw new Error('No URL configured');
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: cfg.headers ?? {} },
      fetch: lenientFetch(cfg.name),
      ...(cfg.auth === 'oauth' ? { authProvider: new SableOAuthProvider(cfg) } : {}),
    });
  } else {
    if (!cfg.command) throw new Error('No command configured');
    transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...getDefaultEnvironment(), ...proxyEnv(), ...(cfg.env ?? {}) },
      cwd: WORKSPACE_DIR,
      stderr: 'ignore',
    });
  }
  const client = new Client({ name: 'sable', version: '0.1.0' });
  try {
    await client.connect(transport);
  } catch (err) {
    if (err instanceof UnauthorizedError || (cfg.auth === 'oauth' && /unauthori[sz]ed|401/i.test(String((err as Error).message)))) {
      const info = oauthInfo(cfg.id);
      status.set(cfg.id, { id: cfg.id, name: cfg.name, state: 'needs_auth', tools: [], authUrl: info.authUrl, oauth: true });
      return;
    }
    throw err;
  }
  if (cfg.auth === 'oauth' && !oauthInfo(cfg.id).connected) {
    // Some servers (e.g. Google's) list tools without a token but reject every call. Not connected yet.
    await client.close().catch(() => {});
    status.set(cfg.id, { id: cfg.id, name: cfg.name, state: 'needs_auth', tools: [], authUrl: oauthInfo(cfg.id).authUrl, oauth: true });
    return;
  }
  clients.set(cfg.id, client);

  const { tools } = await client.listTools();
  const names: string[] = [];
  for (const t of tools) {
    const name = toolName(cfg.id, t.name);
    names.push(name);
    const schema = (t.inputSchema ?? { type: 'object', properties: {} }) as { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
    registerTool({
      name,
      label: `${cfg.name}: ${t.annotations?.title ?? t.name}`,
      group: cfg.name,
      source: 'mcp',
      description: `[${cfg.name}] ${t.description ?? t.name}`.slice(0, 1024),
      parameters: { type: 'object', properties: schema.properties ?? {}, required: schema.required ?? [] },
      risk: t.annotations?.readOnlyHint ? 'low' : 'high',
      defaultPolicy: 'ask',
      summarize: (a) => `${cfg.name} → ${t.name}(${truncate(JSON.stringify(a), 120)})`,
      async run(args, ctx) {
        let res;
        try {
          res = await client.callTool({ name: t.name, arguments: args }, undefined, { signal: ctx.signal, timeout: 120_000 });
        } catch (err) {
          if (err instanceof UnauthorizedError || /unauthori[sz]ed|\b401\b/i.test(errorMessage(err))) {
            status.set(cfg.id, { id: cfg.id, name: cfg.name, state: 'needs_auth', tools: names, authUrl: oauthInfo(cfg.id).authUrl, oauth: cfg.auth === 'oauth' });
            emit({ type: 'mcp.changed' });
            throw new Error(
              `${cfg.name} is not signed in (or its sign-in expired). Tell the user to open Settings → Connectors and press Connect on ${cfg.name}. Don't retry until they have.`,
            );
          }
          throw new Error(shortMcpError(cfg.name, err));
        }
        const parts = ((res.content ?? []) as { type: string; text?: string; mimeType?: string }[]).map((c) =>
          c.type === 'text' ? (c.text ?? '') : `[${c.type}${c.mimeType ? ' ' + c.mimeType : ''} content omitted]`,
        );
        const text = truncate(parts.join('\n') || '(no output)', 30_000);
        if (res.isError) throw new Error(text);
        return untrusted(cfg.name, text);
      },
    });
  }
  status.set(cfg.id, { id: cfg.id, name: cfg.name, state: 'connected', tools: names, oauth: cfg.auth === 'oauth' });
}

/** (Re)connect every enabled connector to match the current settings. */
export async function reloadMcp() {
  for (const [, c] of clients) await c.close().catch(() => {});
  clients.clear();
  status.clear();
  unregisterWhere((t) => t.source === 'mcp');
  await Promise.all(
    getSettings()
      .mcpServers.filter((s) => s.enabled)
      .map(async (s) => {
        try {
          await connect(s);
        } catch (err) {
          status.set(s.id, { id: s.id, name: s.name, state: 'error', error: shortMcpError(s.name, err), tools: [] });
        }
      }),
  );
  emit({ type: 'mcp.changed' });
}

/** Finish an OAuth sign-in: exchange the code for tokens, then reconnect. */
export async function completeOAuth(serverId: string, code: string) {
  const cfg = getSettings().mcpServers.find((s) => s.id === serverId);
  if (!cfg?.url) throw new Error('Unknown connector');
  const result = await auth(new SableOAuthProvider(cfg, { exchanging: true }), { serverUrl: cfg.url, authorizationCode: code, scope: cfg.oauth?.scope });
  if (result !== 'AUTHORIZED') throw new Error('The provider did not authorize the connection');
  await reloadMcp();
}

/** Start (or restart) sign-in for one connector and return the URL to open. */
export async function beginOAuth(serverId: string, callbackUrl: string): Promise<string | undefined> {
  const cfg = getSettings().mcpServers.find((s) => s.id === serverId);
  if (!cfg?.url) throw new Error('Unknown connector');
  prepareRedirect(cfg, callbackUrl);
  const provider = new SableOAuthProvider(cfg);
  provider.invalidateCredentials('tokens');
  const result = await auth(provider, { serverUrl: cfg.url, scope: cfg.oauth?.scope });
  if (result === 'AUTHORIZED') {
    await reloadMcp();
    return undefined;
  }
  return oauthInfo(serverId).authUrl;
}
