import crypto from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { PORT } from '../../config.js';
import { kvDel, kvGet, kvSet } from '../../db.js';
import { publicBase } from '../../push.js';
import type { McpServerConfig } from '../../settings.js';

/**
 * OAuth for remote MCP connectors ("Connect account"). The MCP SDK does discovery, dynamic client
 * registration, PKCE and token refresh; this provider just persists the pieces on the server.
 * Tokens never reach the browser or the model.
 */

interface Stored {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  authUrl?: string;
  redirectUrl?: string;
  connectedAt?: number;
}

const key = (id: string) => `mcp_oauth:${id}`;

export function oauthCallbackUrl() {
  return `${publicBase() || `http://localhost:${PORT}`}/api/mcp/oauth/callback`;
}

export function serverForState(state: string): string | undefined {
  return kvGet<string>(`mcp_oauth_state:${state}`);
}
export function clearState(state: string) {
  kvDel(`mcp_oauth_state:${state}`);
}

export function oauthInfo(id: string) {
  const s = kvGet<Stored>(key(id));
  return { connected: !!s?.tokens?.access_token, connectedAt: s?.connectedAt, authUrl: s?.authUrl };
}

export function forgetOAuth(id: string) {
  kvDel(key(id));
}

export class SableOAuthProvider implements OAuthClientProvider {
  constructor(private cfg: McpServerConfig) {}

  private load(): Stored {
    return kvGet<Stored>(key(this.cfg.id)) ?? {};
  }
  private save(patch: Partial<Stored>) {
    kvSet(key(this.cfg.id), { ...this.load(), ...patch });
  }

  get redirectUrl() {
    // Keep using the URL the client was registered with, so a later Public URL change doesn't break it.
    return this.load().redirectUrl ?? oauthCallbackUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Sable (self-hosted agent)',
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.cfg.oauth?.clientSecret ? 'client_secret_post' : 'none',
      ...(this.cfg.oauth?.scope ? { scope: this.cfg.oauth.scope } : {}),
    };
  }

  state() {
    const s = crypto.randomBytes(24).toString('base64url');
    kvSet(`mcp_oauth_state:${s}`, this.cfg.id);
    return s;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.cfg.oauth?.clientId) {
      return { client_id: this.cfg.oauth.clientId, ...(this.cfg.oauth.clientSecret ? { client_secret: this.cfg.oauth.clientSecret } : {}) };
    }
    return this.load().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.save({ client, redirectUrl: String(this.redirectUrl) });
  }

  tokens() {
    return this.load().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.save({ tokens, authUrl: undefined, connectedAt: Date.now() });
  }

  redirectToAuthorization(url: URL) {
    // Google only issues refresh tokens for offline access; ask for it so the connection lasts.
    if (url.hostname === 'accounts.google.com') {
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
    }
    this.save({ authUrl: url.toString() });
  }

  saveCodeVerifier(verifier: string) {
    this.save({ verifier });
  }
  codeVerifier() {
    const v = this.load().verifier;
    if (!v) throw new Error('No PKCE verifier saved. Start the connection again.');
    return v;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') return forgetOAuth(this.cfg.id);
    if (scope === 'client') this.save({ client: undefined, redirectUrl: undefined });
    if (scope === 'tokens') this.save({ tokens: undefined });
    if (scope === 'verifier') this.save({ verifier: undefined });
  }
}
