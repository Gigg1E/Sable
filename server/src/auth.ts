import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { get, kvGet, kvSet, run } from './db.js';
import { now } from './util.js';

/**
 * Single-user authentication for one Sable instance.
 *
 * - Password hashed with scrypt; comparisons are constant-time.
 * - Session cookie is HttpOnly, SameSite=Lax, and on HTTPS uses the `__Host-` prefix, which forbids a
 *   Domain attribute: a sibling site on the same parent domain can't set or overwrite it.
 * - The cookie name includes a per-instance id, so several Sable instances on one host (different
 *   ports or paths behind a proxy) never collide or log each other out.
 * - Optional TOTP two-factor (RFC 6238) with single-use recovery codes.
 */

const SESSION_DAYS = 30;

/** Random id for this data folder; distinguishes instances that share a hostname. */
export function instanceId(): string {
  let iid = kvGet<string>('instance_id');
  if (!iid) {
    iid = crypto.randomBytes(5).toString('hex');
    kvSet('instance_id', iid);
  }
  return iid;
}
const cookieName = (secure: boolean) => (secure ? `__Host-sable-${instanceId()}` : `sable-${instanceId()}`);

interface Credentials {
  salt: string;
  hash: string;
}
interface TwoFactor {
  secret: string; // base32
  enabled: boolean;
  recovery: string[]; // sha256 hashes of unused recovery codes
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function isSetUp() {
  return !!kvGet<Credentials>('auth');
}

export function setPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  kvSet('auth', { salt, hash: hashPassword(password, salt) });
}

export function checkPassword(password: string): boolean {
  const creds = kvGet<Credentials>('auth');
  if (!creds) return false;
  const a = Buffer.from(hashPassword(password, creds.salt), 'hex');
  const b = Buffer.from(creds.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ───────────────────────── Sessions ─────────────────────────

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(req: Request, res: Response) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = now() + SESSION_DAYS * 86_400_000;
  // Only a hash of the token is stored, so a leaked database can't be used to log in.
  run('INSERT INTO sessions (token, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)', sha(token), now(), expires, (req.get('user-agent') ?? '').slice(0, 200));
  res.cookie(cookieName(req.secure), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

function readCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return;
  const want = new Set([cookieName(true), cookieName(false)]);
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (want.has(k)) return decodeURIComponent(v.join('='));
  }
}

export function destroySession(req: Request, res: Response) {
  const token = readCookie(req);
  if (token) run('DELETE FROM sessions WHERE token = ?', sha(token));
  res.clearCookie(cookieName(req.secure), { path: '/', secure: req.secure, httpOnly: true, sameSite: 'lax' });
}

export function destroyAllSessions() {
  run('DELETE FROM sessions');
}

export function sessionCount() {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', now())?.n ?? 0;
}

export function isAuthed(req: Request): boolean {
  const token = readCookie(req);
  if (!token) return false;
  const row = get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token = ?', sha(token));
  return !!row && row.expires_at > now();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

// Brute-force protection: 10 failed attempts per IP per 15 minutes, plus a global brake.
const attempts = new Map<string, { count: number; reset: number }>();
let globalFails: number[] = [];
export function loginAllowed(ip: string): boolean {
  globalFails = globalFails.filter((t) => now() - t < 60_000);
  if (globalFails.length > 30) return false;
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now()) return true;
  return entry.count < 10;
}
export function recordFailedLogin(ip: string) {
  globalFails.push(now());
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now()) attempts.set(ip, { count: 1, reset: now() + 15 * 60_000 });
  else entry.count++;
}

// ───────────────────────── TOTP two-factor ─────────────────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

let lastUsedStep = 0;
function verifyTotp(secret: string, code: string) {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(Date.now() / 30_000);
  for (const d of [0, -1, 1]) {
    const s = step + d;
    // Each code works once (blocks replay of an observed code).
    if (s > lastUsedStep && crypto.timingSafeEqual(Buffer.from(totp(secret, s)), Buffer.from(c))) {
      lastUsedStep = s;
      return true;
    }
  }
  return false;
}

export function twoFactorEnabled() {
  return !!kvGet<TwoFactor>('2fa')?.enabled;
}

/** Start (or restart) 2FA setup: returns the secret and otpauth URI to show as a QR code. */
export function beginTwoFactor(label: string) {
  const secret = base32Encode(crypto.randomBytes(20));
  kvSet('2fa_pending', secret);
  const uri = `otpauth://totp/${encodeURIComponent(`Sable:${label}`)}?secret=${secret}&issuer=Sable&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

/** Confirm setup with a code from the app; returns one-time recovery codes. */
export function confirmTwoFactor(code: string): string[] | null {
  const secret = kvGet<string>('2fa_pending');
  if (!secret || !verifyTotp(secret, code)) return null;
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  kvSet('2fa', { secret, enabled: true, recovery: codes.map(sha) } satisfies TwoFactor);
  kvSet('2fa_pending', null);
  return codes;
}

export function disableTwoFactor() {
  kvSet('2fa', null);
}

/** Check a TOTP code or an unused recovery code (which is then consumed). */
export function checkSecondFactor(code: string): boolean {
  const tf = kvGet<TwoFactor>('2fa');
  if (!tf?.enabled) return true;
  if (verifyTotp(tf.secret, code)) return true;
  const h = sha(code.trim().toLowerCase());
  const idx = tf.recovery.indexOf(h);
  if (idx >= 0) {
    tf.recovery.splice(idx, 1);
    kvSet('2fa', tf);
    return true;
  }
  return false;
}

export function recoveryCodesLeft() {
  return kvGet<TwoFactor>('2fa')?.recovery.length ?? 0;
}
