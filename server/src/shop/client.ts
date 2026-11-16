import { agentFetch } from '../net.js';
import { errorMessage } from '../util.js';
import { invalidateShopToken, SHOP_MCP, shopAccessToken } from './auth.js';

/**
 * Minimal client for Shop MCP (protocol 2026-07-28: stateless HTTP, no initialize; every request
 * carries MCP-Protocol-Version / Mcp-Method headers and protocol _meta). Goes through the agent's
 * network path, so the VPN proxy applies.
 */

const VERSION = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'sable', version: '0.1.0' },
};

export interface ShopMessage {
  type?: string;
  code?: string;
  content?: string;
  severity?: string;
}

export class ShopError extends Error {
  constructor(message: string, public messages: ShopMessage[] = [], public data?: unknown) {
    super(message);
  }
}

let rpc = 1;

async function post(method: string, name: string | undefined, params: Record<string, unknown>, signal?: AbortSignal, token?: string) {
  const res = await agentFetch(
    SHOP_MCP,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': VERSION,
        'Mcp-Method': method,
        ...(name ? { 'Mcp-Name': name } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method, params: { ...params, _meta: META } }),
    },
    signal,
  );
  return res;
}

function parseBody(text: string, type: string): any {
  if (/event-stream/i.test(type)) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:'));
    return JSON.parse(lines[lines.length - 1]?.slice(5) ?? '{}');
  }
  return JSON.parse(text);
}

/** Call a Shop tool and return its structured result. Throws ShopError with Shop's own messages. */
export async function shopCall<T = any>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const token = await shopAccessToken();
  const res = await post('tools/call', name, { name, arguments: args }, signal, token);
  if (res.status === 401) {
    if (token) {
      // Rejected token: stop using it (never silently fall back to anonymous for account actions).
      invalidateShopToken('Shop rejected the saved sign-in. Link your account again.');
      throw new ShopError('Your Shop account sign-in expired. Link it again in Settings → Shopping.');
    }
    throw new ShopError('This needs a linked Shop account (Settings → Shopping).');
  }
  if (res.status === 403) throw new ShopError('Shop refused this request for the linked account (check that the connection allows it).');
  if (res.status >= 500) throw new ShopError(`Shop is having trouble right now (HTTP ${res.status}). Try again shortly.`);
  const text = await res.text();
  let body: any;
  try {
    body = parseBody(text, res.headers.get('content-type') ?? '');
  } catch {
    throw new ShopError(`Shop returned an unexpected response (HTTP ${res.status}).`);
  }
  if (body.error) throw new ShopError(`Shop: ${body.error.message ?? 'error'}`, [], body.error.data);
  const result = body.result ?? {};
  const data = result.structuredContent ?? (() => {
    try {
      return JSON.parse(result.content?.[0]?.text ?? '{}');
    } catch {
      return {};
    }
  })();
  if (result.isError) {
    const msgs: ShopMessage[] = data?.messages ?? [];
    throw new ShopError(msgs.map((m) => m.content).filter(Boolean).join(' ') || result.content?.[0]?.text || 'Shop reported an error.', msgs, data);
  }
  void res;
  return data as T;
}

export function shopErrorText(err: unknown) {
  return err instanceof ShopError ? err.message : errorMessage(err);
}
