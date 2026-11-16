import crypto from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { kvDel, kvGet, kvSet } from '../db.js';
import { publicBase } from '../push.js';

/**
 * "Link Shop account": OAuth 2.1 + PKCE against accounts.shop.app. Shop doesn't do dynamic client
 * registration; it reads a client metadata document from a URL we publish
 * (/oauth/sable-client.json), so Sable must be reachable over public HTTPS for linking.
 * Tokens stay on the server; the model never sees them.
 */

export const SHOP_MCP = process.env.SABLE_SHOP_MCP ?? 'https://mcp.shop.com';
const SCOPE = 'personal_agent';
const KEY = 'shop_oauth';

interface Stored {
  tokens?: OAuthTokens;
  expiresAt?: number;
  verifier?: string;
  authUrl?: string;
  client?: OAuthClientInformationMixed;
  linkedAt?: number;
}
const load = () => kvGet<Stored>(KEY) ?? {};
const save = (patch: Partial<Stored>) => kvSet(KEY, { ...load(), ...patch });

export const shopClientMetadataUrl = () => `${publicBase()}/oauth/sable-client.json`;
export const shopCallbackUrl = () => `${publicBase()}/api/shop/oauth/callback`;

/** The document Shop fetches to learn about this client (served publicly). */
export function shopClientMetadataDocument() {
  return {
    client_id: shopClientMetadataUrl(),
    client_name: 'Sable (self-hosted personal agent)',
    client_uri: publicBase() || undefined,
    redirect_uris: [shopCallbackUrl()],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPE,
  };
}

class ShopProvider implements OAuthClientProvider {
  get redirectUrl() {
    return shopCallbackUrl();
  }
  get clientMetadataUrl() {
    return shopClientMetadataUrl();
  }
  get clientMetadata(): OAuthClientMetadata {
    const d = shopClientMetadataDocument();
    return { client_name: d.client_name, redirect_uris: d.redirect_uris, grant_types: d.grant_types, response_types: d.response_types, token_endpoint_auth_method: 'none', scope: SCOPE };
  }
  state() {
    const s = crypto.randomBytes(24).toString('base64url');
    kvSet(`shop_oauth_state:${s}`, Date.now());
    return s;
  }
  clientInformation() {
    return load().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    save({ client });
  }
  tokens() {
    return load().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    save({ tokens, expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined, authUrl: undefined, linkedAt: load().linkedAt ?? Date.now() });
  }
  redirectToAuthorization(url: URL) {
    save({ authUrl: url.toString() });
  }
  saveCodeVerifier(verifier: string) {
    save({ verifier });
  }
  codeVerifier() {
    const v = load().verifier;
    if (!v) throw new Error('Sign-in session expired. Start linking again.');
    return v;
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') kvDel(KEY);
    else if (scope === 'tokens') save({ tokens: undefined, expiresAt: undefined });
    else if (scope === 'client') save({ client: undefined });
    else if (scope === 'verifier') save({ verifier: undefined });
  }
}

export function shopLinkStatus() {
  const s = load();
  return { linked: !!s.tokens?.access_token, linkedAt: s.linkedAt ?? null };
}

/** Start linking; returns the URL to open in the browser. */
export async function beginShopLink(): Promise<string> {
  const base = publicBase();
  if (!/^https:\/\//.test(base)) {
    throw new Error('Linking a Shop account needs Sable on a public HTTPS address. Set Settings → Network → Public URL (e.g. https://sable.example.com) first.');
  }
  kvSet(KEY, {}); // fresh start
  const result = await auth(new ShopProvider(), { serverUrl: SHOP_MCP, scope: SCOPE });
  if (result === 'AUTHORIZED') return '';
  const url = load().authUrl;
  if (!url) throw new Error('Shop did not return a sign-in page.');
  return url;
}

export function isShopState(state: string) {
  const ok = !!kvGet<number>(`shop_oauth_state:${state}`);
  kvDel(`shop_oauth_state:${state}`);
  return ok;
}

export async function completeShopLink(code: string) {
  const result = await auth(new ShopProvider(), { serverUrl: SHOP_MCP, authorizationCode: code, scope: SCOPE });
  if (result !== 'AUTHORIZED') throw new Error('Shop did not authorize the link.');
}

export function unlinkShop() {
  kvDel(KEY);
}

/** A valid access token if linked (refreshing when close to expiry), else undefined. */
export async function shopAccessToken(): Promise<string | undefined> {
  const s = load();
  if (!s.tokens?.access_token) return undefined;
  if (s.expiresAt && s.expiresAt - Date.now() < 60_000 && s.tokens.refresh_token) {
    try {
      await auth(new ShopProvider(), { serverUrl: SHOP_MCP, scope: SCOPE });
    } catch {
      return undefined;
    }
    return load().tokens?.access_token;
  }
  return s.tokens.access_token;
}
