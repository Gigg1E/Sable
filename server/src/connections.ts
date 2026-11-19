import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { all, get, run } from './db.js';
import { agentFetch } from './net.js';
import { now } from './util.js';

/**
 * Self-built connections: the agent researches an API, defines a connection (name, base URL, auth
 * style, which methods count as reads) and the user approves it once. The credential is entered
 * by the user, stored encrypted, and added to requests by this module only: the model never sees
 * it, it is only ever sent to the connection's own host, and it is redacted from every response.
 */

export type AuthStyle = 'bearer' | 'header' | 'query' | 'basic' | 'aws-sigv4' | 'none';
export interface ConnectionAuth {
  style: AuthStyle;
  /** header: the header name, e.g. X-Api-Key. */
  header?: string;
  /** query: the parameter name, e.g. api_key. */
  param?: string;
  /** aws-sigv4 */
  region?: string;
  service?: string;
}
export interface ConnectionRow {
  name: string;
  base_url: string;
  auth: string;
  read_methods: string;
  purpose: string;
  credential_help: string | null;
  secret_enc: string | null;
  created_at: number;
  last_used: number | null;
}
export interface Connection {
  name: string;
  baseUrl: string;
  host: string;
  auth: ConnectionAuth;
  readMethods: string[];
  purpose: string;
  credentialHelp: string;
  hasSecret: boolean;
  createdAt: number;
  lastUsed: number | null;
}

// ───────────── Vault: AES-256-GCM, key kept in a file only the server can read ─────────────

let vaultKey: Buffer | null = null;
function key(): Buffer {
  if (vaultKey) return vaultKey;
  const fromEnv = process.env.SABLE_VAULT_KEY;
  if (fromEnv) return (vaultKey = crypto.createHash('sha256').update(fromEnv).digest());
  const file = path.join(DATA_DIR, 'vault.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return (vaultKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'));
}
function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function open(sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ───────────── Store ─────────────

export const validName = (n: string) => /^[a-z][a-z0-9_-]{1,31}$/.test(n);

function toConnection(r: ConnectionRow): Connection {
  const u = new URL(r.base_url);
  return {
    name: r.name,
    baseUrl: r.base_url,
    host: u.host,
    auth: JSON.parse(r.auth),
    readMethods: JSON.parse(r.read_methods),
    purpose: r.purpose,
    credentialHelp: r.credential_help ?? '',
    hasSecret: !!r.secret_enc,
    createdAt: r.created_at,
    lastUsed: r.last_used,
  };
}

export function listConnections(): Connection[] {
  return all<ConnectionRow>('SELECT * FROM connections ORDER BY name').map(toConnection);
}
export function getConnection(name: string): Connection | undefined {
  const r = get<ConnectionRow>('SELECT * FROM connections WHERE name = ?', name.toLowerCase());
  return r ? toConnection(r) : undefined;
}

export function normalizeDefinition(d: { name: string; base_url: string; auth: ConnectionAuth; read_methods?: string[]; purpose: string; credential_help?: string }) {
  const name = String(d.name).toLowerCase().trim();
  if (!validName(name)) throw new Error('Name must be 2-32 lowercase letters, numbers, - or _, starting with a letter.');
  let u: URL;
  try {
    u = new URL(String(d.base_url));
  } catch {
    throw new Error('base_url is not a valid URL.');
  }
  if (u.protocol !== 'https:') throw new Error('Connections must use https.');
  if (u.username || u.password) throw new Error("Don't put credentials in the URL; the user stores them separately.");
  const style = d.auth?.style;
  if (!['bearer', 'header', 'query', 'basic', 'aws-sigv4', 'none'].includes(style)) throw new Error('auth.style must be bearer, header, query, basic, aws-sigv4 or none.');
  if (style === 'header' && !/^[A-Za-z0-9-]{1,64}$/.test(d.auth.header ?? '')) throw new Error('auth.header (the header name) is required for style "header".');
  if (style === 'query' && !/^[A-Za-z0-9_.-]{1,64}$/.test(d.auth.param ?? '')) throw new Error('auth.param (the query parameter name) is required for style "query".');
  if (style === 'aws-sigv4' && (!d.auth.region || !d.auth.service)) throw new Error('auth.region and auth.service are required for aws-sigv4.');
  const reads = [...new Set((d.read_methods?.length ? d.read_methods : ['GET', 'HEAD']).map((m) => String(m).toUpperCase()))].filter((m) => ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m));
  const auth: ConnectionAuth = { style, ...(d.auth.header ? { header: d.auth.header } : {}), ...(d.auth.param ? { param: d.auth.param } : {}), ...(d.auth.region ? { region: d.auth.region } : {}), ...(d.auth.service ? { service: d.auth.service } : {}) };
  return { name, baseUrl: u.toString().replace(/\/+$/, ''), auth, readMethods: reads, purpose: String(d.purpose ?? '').slice(0, 300), credentialHelp: String(d.credential_help ?? '').slice(0, 800) };
}

export function saveConnection(d: ReturnType<typeof normalizeDefinition>) {
  const existing = get<ConnectionRow>('SELECT * FROM connections WHERE name = ?', d.name);
  // Changing where a connection points drops its credential, so a key can't follow it to a new host.
  const keepSecret = existing && new URL(existing.base_url).host === new URL(d.baseUrl).host && existing.auth === JSON.stringify(d.auth);
  run(
    `INSERT INTO connections (name, base_url, auth, read_methods, purpose, credential_help, secret_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET base_url = excluded.base_url, auth = excluded.auth, read_methods = excluded.read_methods, purpose = excluded.purpose, credential_help = excluded.credential_help, secret_enc = ?`,
    d.name, d.baseUrl, JSON.stringify(d.auth), JSON.stringify(d.readMethods), d.purpose, d.credentialHelp, keepSecret ? existing!.secret_enc : null, now(),
    keepSecret ? existing!.secret_enc : null,
  );
}

export function setSecret(name: string, value: string) {
  if (!getConnection(name)) throw new Error('No such connection.');
  run('UPDATE connections SET secret_enc = ? WHERE name = ?', value ? seal(value) : null, name.toLowerCase());
}
export function removeConnection(name: string) {
  return run('DELETE FROM connections WHERE name = ?', name.toLowerCase()).changes > 0;
}
function secretOf(name: string): string | null {
  const r = get<{ secret_enc: string | null }>('SELECT secret_enc FROM connections WHERE name = ?', name.toLowerCase());
  return r?.secret_enc ? open(r.secret_enc) : null;
}

// ───────────── AWS Signature V4 ─────────────

const sha256 = (d: string | Buffer) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => crypto.createHmac('sha256', k).update(d).digest();

export function signAws(req: { method: string; url: URL; headers: Record<string, string>; body: string }, auth: ConnectionAuth, secret: string) {
  const [accessKey, secretKey, sessionToken] = secret.split(':');
  if (!accessKey || !secretKey) throw new Error('The AWS credential must be ACCESS_KEY_ID:SECRET_ACCESS_KEY (optionally :SESSION_TOKEN).');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const h: Record<string, string> = { ...req.headers, host: req.url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': sha256(req.body) };
  if (sessionToken) h['x-amz-security-token'] = sessionToken;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalQuery = [...req.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalPath = req.url.pathname.split('/').map((s) => encodeURIComponent(decodeURIComponent(s))).join('/') || '/';
  const canonical = [req.method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), lower['x-amz-content-sha256']].join('\n');
  const scope = `${date}/${auth.region}/${auth.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), auth.region!), auth.service!), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

// ───────────── Calling ─────────────

/** Replace any trace of the secret (and its parts) in text the model will see. */
function redact(text: string, secret: string | null) {
  if (!secret) return text;
  let out = text;
  const parts = [secret, ...secret.split(':'), Buffer.from(secret).toString('base64')].filter((p) => p.length >= 6);
  for (const p of parts) out = out.split(p).join('[REDACTED]');
  return out;
}

export async function callConnection(
  name: string,
  req: { path?: string; method?: string; query?: Record<string, unknown>; json_body?: unknown; body?: string; headers?: Record<string, string> },
  signal?: AbortSignal,
): Promise<{ status: number; contentType: string; body: string }> {
  const c = getConnection(name);
  if (!c) throw new Error(`No connection named "${name}". List them with connect_list, or research the API and define one with connect_define.`);
  const method = String(req.method ?? 'GET').toUpperCase();
  // Host lock: the credential only ever goes to this connection's own server.
  const raw = String(req.path ?? '/');
  let url: URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    url = new URL(raw);
    if (url.host !== c.host) throw new Error(`Refused: "${name}" is locked to ${c.host}; it can't be used to call ${url.host}.`);
  } else {
    const base = new URL(c.baseUrl);
    url = new URL(base.pathname.replace(/\/+$/, '') + '/' + raw.replace(/^\/+/, ''), base.origin);
  }
  if (url.protocol !== 'https:') throw new Error('Refused: connections only use https.');
  for (const [k, v] of Object.entries(req.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) if (!/^(authorization|cookie|host|x-amz-.*|proxy-.*)$/i.test(k)) headers[k] = String(v);
  let body = '';
  if (req.json_body !== undefined) {
    body = JSON.stringify(req.json_body);
    headers['content-type'] ??= c.auth.style === 'aws-sigv4' ? 'application/x-amz-json-1.1' : 'application/json';
  } else if (req.body) body = String(req.body);

  const secret = c.auth.style === 'none' ? null : secretOf(name);
  if (c.auth.style !== 'none' && !secret)
    throw new Error(`The "${name}" connection has no credential yet. The user adds it in Settings → Connectors → Connections (or the card in chat).${c.credentialHelp ? ` What to create: ${c.credentialHelp}` : ''}`);
  let finalHeaders = headers;
  if (secret) {
    if (c.auth.style === 'bearer') finalHeaders = { ...headers, authorization: `Bearer ${secret}` };
    else if (c.auth.style === 'header') finalHeaders = { ...headers, [c.auth.header!]: secret };
    else if (c.auth.style === 'query') url.searchParams.set(c.auth.param!, secret);
    else if (c.auth.style === 'basic') finalHeaders = { ...headers, authorization: `Basic ${Buffer.from(secret).toString('base64')}` };
    else if (c.auth.style === 'aws-sigv4') finalHeaders = signAws({ method, url, headers, body }, c.auth, secret);
  }
  run('UPDATE connections SET last_used = ? WHERE name = ?', now(), c.name);
  const res = await agentFetch(url.toString(), { method, headers: finalHeaders, body: method === 'GET' || method === 'HEAD' ? undefined : body || undefined, redirect: 'manual' }, signal);
  // Never follow a redirect with the credential attached (it could lead to another host).
  if (res.status >= 300 && res.status < 400) return { status: res.status, contentType: '', body: `Redirect to ${res.headers.get('location') ?? '?'} (not followed with credentials)` };
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: redact(text, secret).slice(0, 60_000) };
}
