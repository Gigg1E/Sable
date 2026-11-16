import crypto from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { PORT } from '../../config.js';
import { kvDel, kvGet, kvSet } from '../../db.js';
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

/**
 * The sign-in return address. It is a browser redirect, so it must be the address the user opens
 * Sable at (e.g. the private Tailscale URL), never the public webhook front: providers never call it.
 */
export function oauthCallbackUrl(origin?: string) {
  return `${(origin || kvGet<string>('appOrigin') || `http://localhost:${PORT}`).replace(/\/+$/, '')}/api/mcp/oauth/callback`;
}

/** Remember the callback this sign-in uses, so the code exchange sends the identical redirect_uri. */
export function prepareRedirect(cfg: McpServerConfig, callbackUrl: string) {
  const stored = kvGet<Stored>(key(cfg.id)) ?? {};
  // A dynamically registered client is bound to its redirect URI: register again if the address changed.
  const client = !cfg.oauth?.clientId && stored.redirectUrl && stored.redirectUrl !== callbackUrl ? undefined : stored.client;
  kvSet(key(cfg.id), { ...stored, client, redirectUrl: callbackUrl });
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
  /** exchanging: finishing a sign-in. A rejected client then fails with a clear error instead of being wiped and retried. */
  constructor(
    private cfg: McpServerConfig,
    private opts: { exchanging?: boolean } = {},
  ) {}

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
    if (scope === 'all' && this.opts.exchanging) {
      // The SDK calls this when the provider answers invalid_client / unauthorized_client, then retries,
      // which would only surface a confusing "no verifier" error. Report the real problem instead.
      const redirect = String(this.redirectUrl);
      if (!this.cfg.oauth?.clientId) this.save({ client: undefined });
      this.save({ verifier: undefined });
      throw new Error(
        this.cfg.oauth?.clientId
          ? `The provider rejected the OAuth client. Check the Client ID and secret, that the client type is "Web application", and that its authorized redirect URI is exactly ${redirect}`
          : `The provider rejected Sable's registration. Press Connect again to register afresh (redirect URI ${redirect}).`,
      );
    }
    if (scope === 'all') return forgetOAuth(this.cfg.id);
    if (scope === 'client') this.save({ client: undefined, redirectUrl: undefined });
    if (scope === 'tokens') this.save({ tokens: undefined });
    if (scope === 'verifier') this.save({ verifier: undefined });
  }
}
