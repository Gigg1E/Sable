import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { get, kvGet, kvSet, run } from './db.js';
import { now } from './util.js';

const COOKIE = 'sable_session';
const SESSION_DAYS = 30;

interface Credentials {
  salt: string;
  hash: string;
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

export function createSession(req: Request, res: Response) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = now() + SESSION_DAYS * 86_400_000;
  run('INSERT INTO sessions (token, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)', token, now(), expires, req.get('user-agent') ?? '');
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

export function destroySession(req: Request, res: Response) {
  const token = readCookie(req);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

export function destroyAllSessions() {
  run('DELETE FROM sessions');
}

function readCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
}

export function isAuthed(req: Request): boolean {
  const token = readCookie(req);
  if (!token) return false;
  const row = get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token = ?', token);
  return !!row && row.expires_at > now();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

// Simple brute-force protection: 10 failed attempts per IP per 15 minutes.
const attempts = new Map<string, { count: number; reset: number }>();
export function loginAllowed(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now()) return true;
  return entry.count < 10;
}
export function recordFailedLogin(ip: string) {
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now()) attempts.set(ip, { count: 1, reset: now() + 15 * 60_000 });
  else entry.count++;
}
