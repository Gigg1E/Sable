import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { AGENT_USER_AGENT } from './config.js';

/**
 * Outbound "reach-out" traffic (web search, page reads, HTTP requests, scripts, connectors)
 * can be forced through a proxy — e.g. a VPN container like gluetun — so the server's real IP
 * never touches the sites the agent visits. Model APIs and Ollama stay on the normal network.
 *
 * There is deliberately no fallback: if the proxy is down, agent web access fails closed.
 */
export const AGENT_PROXY = (process.env.SABLE_AGENT_PROXY ?? '').trim();

const dispatcher = AGENT_PROXY ? new ProxyAgent({ uri: AGENT_PROXY, connect: { timeout: 15_000 } }) : undefined;

/** Proxy URL with any credentials removed, for display. */
export function proxyLabel(): string | null {
  if (!AGENT_PROXY) return null;
  try {
    const u = new URL(AGENT_PROXY);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'configured';
  }
}

/** Environment variables that point child processes (scripts, MCP servers) at the proxy. */
export function proxyEnv(): Record<string, string> {
  if (!AGENT_PROXY) return {};
  return {
    HTTP_PROXY: AGENT_PROXY,
    HTTPS_PROXY: AGENT_PROXY,
    ALL_PROXY: AGENT_PROXY,
    http_proxy: AGENT_PROXY,
    https_proxy: AGENT_PROXY,
    all_proxy: AGENT_PROXY,
    NO_PROXY: '',
    no_proxy: '',
  };
}

/** fetch() for anything the agent does on the internet: identifies itself, honours the proxy. */
export async function agentFetch(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(25_000);
  const opts = {
    redirect: 'follow' as const,
    ...init,
    headers: { 'User-Agent': AGENT_USER_AGENT, Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5', ...((init.headers as Record<string, string>) ?? {}) },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  };
  if (dispatcher) {
    try {
      return (await undiciFetch(url, { ...(opts as object), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause?.message;
      throw new Error(`Request through the agent proxy failed${cause ? `: ${cause}` : ''}. Is the VPN container up?`);
    }
  }
  return fetch(url, opts);
}

/** Report the public IP sites see when the agent reaches out. */
export async function checkExitIp(): Promise<{ ip: string; viaProxy: boolean; proxy: string | null }> {
  const res = await agentFetch('https://api.ipify.org?format=json');
  const data = (await res.json()) as { ip: string };
  return { ip: data.ip, viaProxy: !!dispatcher, proxy: proxyLabel() };
}
