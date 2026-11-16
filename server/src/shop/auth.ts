import crypto from 'node:crypto';
import { kvDel, kvGet, kvSet } from '../db.js';
import { emit } from '../events.js';
import { notify, publicBase } from '../push.js';
import { getSettings } from '../settings.js';
import { errorMessage } from '../util.js';

/**
 * Linking a Shop account (see shop.dev/docs/authentication).
 *
 * Default: the OAuth device flow (RFC 8628) with Shop's public client, which Shop documents for
 * "a shopper's own agent". The user opens a Shop link, checks a code and approves; no public URL
 * or redirect is needed. Optional: the user's own registered Shop app client (Dev Dashboard,
 * enabled for personal_agent) using the authorization-code flow with PKCE and refresh tokens.
 *
 * Tokens stay on the server and are only sent to https://mcp.shop.com in the Authorization header.
 */

export const SHOP_MCP = process.env.SABLE_SHOP_MCP ?? 'https://mcp.shop.com';
const RESOURCE = 'https://mcp.shop.com';
const AS = 'https://accounts.shop.app';
const PUBLIC_CLIENT = '5c733ab2-1903-400a-891e-7ba20c09e2a3';
const KEY = 'shop_auth';

interface Stored {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | null;
  clientId?: string;
  linkedAt?: number;
  /** Pending device-flow sign-in (device_code is a credential; never sent to the browser). */
  pending?: { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; interval: number; expiresAt: number };
  /** Pending authorization-code sign-in. */
  pkce?: { state: string; verifier: string; redirectUri: string; startedAt: number };
  error?: string;
}

const load = () => kvGet<Stored>(KEY) ?? {};
const save = (patch: Partial<Stored>) => kvSet(KEY, { ...load(), ...patch });

function ownClient() {
  const s = getSettings().shopping;
  return s.clientId?.trim() ? { id: s.clientId.trim(), secret: s.clientSecret?.trim() || undefined } : null;
}

export const shopCallbackUrl = (origin?: string) => `${(origin || kvGet<string>('appOrigin') || publicBase()).replace(/\/+$/, '')}/api/shop/oauth/callback`;

async function tokenRequest(params: Record<string, string>, client?: { id: string; secret?: string }) {
  const body = new URLSearchParams({ ...params, client_id: client?.id ?? PUBLIC_CLIENT });
  if (client?.secret) body.set('client_secret', client.secret);
  const res = await fetch(`${AS}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(30_000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { ok: res.ok && !!data.access_token, data };
}

function storeTokens(data: Record<string, any>, clientId: string) {
  save({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? load().refreshToken,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
    clientId,
    linkedAt: load().linkedAt ?? Date.now(),
    pending: undefined,
    pkce: undefined,
    error: undefined,
  });
  emit({ type: 'shop.changed' });
}

export function shopLinkStatus() {
  const s = load();
  const expired = !!s.expiresAt && s.expiresAt < Date.now() && !s.refreshToken;
  return {
    linked: !!s.accessToken && !expired,
    expired,
    linkedAt: s.linkedAt ?? null,
    expiresAt: s.expiresAt ?? null,
    method: s.clientId && s.clientId !== PUBLIC_CLIENT ? 'app' : 'device',
    pending: s.pending && s.pending.expiresAt > Date.now() ? { userCode: s.pending.userCode, verificationUri: s.pending.verificationUri, verificationUriComplete: s.pending.verificationUriComplete ?? null, expiresAt: s.pending.expiresAt } : null,
    error: s.error ?? null,
  };
}

// ───────────────────────── Device flow (default) ─────────────────────────

let poller: ReturnType<typeof setTimeout> | null = null;

export async function beginDeviceLink() {
  if (poller) clearTimeout(poller);
  const deviceName = `${getSettings().persona.name || 'Sable'} (personal agent)`.slice(0, 64);
  const body = new URLSearchParams({ client_id: PUBLIC_CLIENT, resource: RESOURCE, scope: 'openid email personal_agent', device_name: deviceName });
  const res = await fetch(`${AS}/oauth/device`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(30_000) });
  const d = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !d.device_code) throw new Error(`Shop didn't start sign-in: ${d.error_description ?? d.error ?? `HTTP ${res.status}`}`);
  save({
    pending: {
      deviceCode: d.device_code,
      userCode: d.user_code,
      verificationUri: d.verification_uri,
      verificationUriComplete: d.verification_uri_complete,
      interval: Math.max(Number(d.interval) || 5, 2),
      expiresAt: Date.now() + (Number(d.expires_in) || 600) * 1000,
    },
    error: undefined,
  });
  schedulePoll();
  emit({ type: 'shop.changed' });
  return shopLinkStatus().pending!;
}

function schedulePoll(delay?: number) {
  const p = load().pending;
  if (!p) return;
  poller = setTimeout(() => void poll(), (delay ?? p.interval) * 1000);
}

async function poll() {
  poller = null;
  const p = load().pending;
  if (!p) return;
  if (p.expiresAt < Date.now()) {
    save({ pending: undefined, error: 'The sign-in code expired. Start linking again.' });
    emit({ type: 'shop.changed' });
    return;
  }
  try {
    // Per Shop's docs, don't send `resource` again: the token is for the resource named when the code was requested.
    const { ok, data } = await tokenRequest({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: p.deviceCode });
    if (ok) {
      storeTokens(data, PUBLIC_CLIENT);
      return;
    }
    if (data.error === 'authorization_pending') return schedulePoll();
    if (data.error === 'slow_down') {
      save({ pending: { ...p, interval: p.interval + 5 } });
      return schedulePoll(p.interval + 5);
    }
    save({ pending: undefined, error: data.error === 'access_denied' ? 'Sign-in was declined in Shop.' : `Shop sign-in failed: ${data.error_description ?? data.error ?? 'unknown error'}` });
    emit({ type: 'shop.changed' });
  } catch (err) {
    // Network hiccup: keep waiting.
    save({ error: errorMessage(err) });
    schedulePoll();
  }
}

/** Resume waiting for an approval after a server restart. */
export function resumeShopLink() {
  if (load().pending) schedulePoll(1);
}

// ───────────────────────── Own app client (optional) ─────────────────────────

export function beginAppLink(origin: string): string {
  const client = ownClient();
  if (!client) throw new Error('No Shop app client configured.');
  if (!/^https:\/\//.test(origin) && !/^http:\/\/localhost[:/]/.test(origin + '/')) throw new Error('Your own Shop app client needs Sable opened over HTTPS (for example your Tailscale address) for the sign-in redirect.');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  const redirectUri = shopCallbackUrl(origin);
  save({ pkce: { state, verifier, redirectUri, startedAt: Date.now() }, error: undefined });
  const u = new URL(`${AS}/oauth/authorize`);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.id,
    redirect_uri: redirectUri,
    scope: 'openid personal_agent',
    resource: RESOURCE,
    state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

export async function completeAppLink(state: string, code: string) {
  const p = load().pkce;
  const client = ownClient();
  if (!p || !client || p.state !== state || Date.now() - p.startedAt > 15 * 60_000) throw new Error('Sign-in expired. Try linking again.');
  const { ok, data } = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, code_verifier: p.verifier }, client);
  if (!ok) throw new Error(`Shop rejected the sign-in: ${data.error_description ?? data.error ?? 'unknown error'}`);
  storeTokens(data, client.id);
}

// ───────────────────────── Tokens ─────────────────────────

export async function unlinkShop() {
  if (poller) clearTimeout(poller);
  const s = load();
  if (s.refreshToken) {
    const client = s.clientId && s.clientId !== PUBLIC_CLIENT ? ownClient() : null;
    const body = new URLSearchParams({ token: s.refreshToken, token_type_hint: 'refresh_token', client_id: client?.id ?? PUBLIC_CLIENT });
    if (client?.secret) body.set('client_secret', client.secret);
    await fetch(`${AS}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) }).catch(() => {});
  }
  kvDel(KEY);
  emit({ type: 'shop.changed' });
}

/** Forget a token Shop rejected, keeping the reason for the UI. */
export function invalidateShopToken(reason: string) {
  save({ accessToken: undefined, refreshToken: undefined, expiresAt: undefined, error: reason });
  emit({ type: 'shop.changed' });
  void notify({ title: 'Shop sign-in expired', body: 'Link your Shop account again in Settings → Shopping to use saved addresses and Shop Pay.', link: '/settings/shopping', kind: 'system' });
}

/** A usable access token, refreshing when possible; undefined when not linked or expired. */
export async function shopAccessToken(): Promise<string | undefined> {
  const s = load();
  if (!s.accessToken) return undefined;
  if (s.expiresAt && s.expiresAt - Date.now() < 60_000) {
    if (!s.refreshToken) return undefined; // expired; the user re-links
    const client = s.clientId && s.clientId !== PUBLIC_CLIENT ? ownClient() ?? undefined : undefined;
    const { ok, data } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken }, client ?? (s.clientId ? { id: s.clientId } : undefined));
    if (!ok) {
      invalidateShopToken('Your Shop sign-in expired. Link it again.');
      return undefined;
    }
    storeTokens(data, s.clientId ?? PUBLIC_CLIENT);
    return data.access_token;
  }
  return s.accessToken;
}
