import crypto from 'node:crypto';
import { open, seal } from './connections.js';
import { kvDel, kvGet, kvSet } from './db.js';
import { emit } from './events.js';
import { notify } from './push.js';
import { getSettings } from './settings.js';
import { errorMessage, now } from './util.js';

/**
 * Sign in with Google: the official OAuth 2.0 web-server flow (with PKCE and offline access) using
 * the user's own Google Cloud OAuth client. One sign-in gives Sable Gmail over IMAP/SMTP (XOAUTH2,
 * scope https://mail.google.com/) and Google Calendar (Calendar API v3, calendar.events).
 * Tokens are stored encrypted; access tokens are refreshed automatically.
 */

export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://mail.google.com/', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
// Overridable only for automated tests against a fake Google.
const AUTH_URL = process.env.SABLE_TEST_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.SABLE_TEST_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const CAL_URL = process.env.SABLE_TEST_GOOGLE_CALENDAR_URL || 'https://www.googleapis.com/calendar/v3';

interface StoredAccount {
  email: string;
  name?: string;
  refresh: string; // sealed
  access?: string; // sealed
  expires?: number;
  scopes: string[];
  linkedAt: number;
  broken?: string;
}
export interface GoogleAccount {
  email: string;
  name?: string;
  scopes: string[];
  linkedAt: number;
  gmail: boolean;
  calendar: boolean;
  broken?: string;
}

const KEY = 'google_accounts';
const stored = () => kvGet<StoredAccount[]>(KEY) ?? [];
const saveAll = (list: StoredAccount[]) => {
  kvSet(KEY, list);
  emit({ type: 'google.changed' });
};

export function googleAccounts(): GoogleAccount[] {
  return stored().map((a) => ({
    email: a.email,
    name: a.name,
    scopes: a.scopes,
    linkedAt: a.linkedAt,
    gmail: a.scopes.includes('https://mail.google.com/'),
    calendar: a.scopes.some((s) => s.includes('/auth/calendar')),
    broken: a.broken,
  }));
}

function client() {
  const g = getSettings().google;
  if (!g?.clientId || !g?.clientSecret) throw new Error('Add your Google OAuth client (Client ID and secret) in Settings → Connectors → Google first.');
  return { id: g.clientId.trim(), secret: g.clientSecret.trim() };
}

// ───────────── Sign-in ─────────────

/** Start sign-in: returns Google's consent URL. `redirectUri` is the address the user opened Sable at. */
export function beginGoogleLink(redirectUri: string, loginHint?: string) {
  const c = client();
  const state = `g_${crypto.randomBytes(18).toString('base64url')}`;
  const verifier = crypto.randomBytes(48).toString('base64url');
  kvSet(`google_state:${state}`, { verifier, redirectUri, at: now() });
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: c.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

export const isGoogleState = (state: string) => state.startsWith('g_') && !!kvGet(`google_state:${state}`);

export async function completeGoogleLink(state: string, code: string): Promise<GoogleAccount> {
  const st = kvGet<{ verifier: string; redirectUri: string; at: number }>(`google_state:${state}`);
  kvDel(`google_state:${state}`);
  if (!st || now() - st.at > 15 * 60_000) throw new Error('This sign-in expired. Press "Sign in with Google" again.');
  const c = client();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: st.redirectUri, grant_type: 'authorization_code', code_verifier: st.verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !tok.access_token) throw new Error(`Google refused the sign-in: ${tok.error_description ?? tok.error ?? res.status}${tok.error === 'invalid_client' ? ' (check the Client ID and secret)' : ''}`);
  const claims = tok.id_token ? JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8')) : {};
  const email = String(claims.email ?? '').toLowerCase();
  if (!email) throw new Error("Google didn't say which account signed in.");
  const list = stored().filter((a) => a.email !== email);
  const previous = stored().find((a) => a.email === email);
  const refresh = tok.refresh_token ? seal(tok.refresh_token) : previous?.refresh;
  if (!refresh) throw new Error('Google sent no refresh token. Remove Sable at myaccount.google.com/connections, then sign in again.');
  const granted = (tok.scope ?? '').split(' ').filter(Boolean);
  list.push({ email, name: claims.name, refresh, access: seal(tok.access_token), expires: now() + (tok.expires_in ?? 3600) * 1000, scopes: granted, linkedAt: now() });
  saveAll(list);
  return googleAccounts().find((a) => a.email === email)!;
}

export function unlinkGoogle(email: string) {
  const list = stored();
  const acc = list.find((a) => a.email === email.toLowerCase());
  saveAll(list.filter((a) => a.email !== email.toLowerCase()));
  if (acc) {
    // Best effort: revoke at Google too.
    void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(acc.refresh))}`, { method: 'POST' }).catch(() => {});
  }
}

// ───────────── Tokens ─────────────

const refreshing = new Map<string, Promise<string>>();

/** A valid access token for this account, refreshed when needed. */
export async function googleToken(email: string): Promise<string> {
  const acc = stored().find((a) => a.email === email.toLowerCase());
  if (!acc) throw new Error(`${email} isn't linked. Sign in with Google in Settings → Connectors → Google.`);
  if (acc.access && acc.expires && acc.expires - now() > 90_000) return open(acc.access);
  const pending = refreshing.get(acc.email);
  if (pending) return pending;
  const p = (async () => {
    const c = client();
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: open(acc.refresh), grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(15_000),
    });
    const tok = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    const list = stored();
    const cur = list.find((a) => a.email === acc.email);
    if (!res.ok || !tok.access_token) {
      const why = tok.error === 'invalid_grant' ? 'Google ended the sign-in (password change, access removed, or a "Testing" app after 7 days)' : `${tok.error ?? res.status} ${tok.error_description ?? ''}`.trim();
      if (cur && !cur.broken) {
        cur.broken = why;
        saveAll(list);
        void notify({ title: `Google account needs signing in again: ${acc.email}`, body: why, link: '/settings/connectors', kind: 'system' });
      }
      throw new Error(`${acc.email}: ${why}. Sign in with Google again in Settings → Connectors → Google.`);
    }
    if (cur) {
      cur.access = seal(tok.access_token);
      cur.expires = now() + (tok.expires_in ?? 3600) * 1000;
      cur.broken = undefined;
      saveAll(list);
    }
    return tok.access_token;
  })().finally(() => refreshing.delete(acc.email));
  refreshing.set(acc.email, p);
  return p;
}

// ───────────── Calendar API v3 ─────────────

async function gcal(email: string, path: string, init: RequestInit = {}) {
  const token = await googleToken(email);
  const res = await fetch(`${CAL_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    const msg = body.error?.message ?? res.status;
    throw new Error(/has not been used|disabled/i.test(String(msg)) ? `The Google Calendar API isn't enabled in your Google Cloud project: enable it, wait a minute, then try again. (${msg})` : `Google Calendar: ${msg}`);
  }
  return body;
}

export interface GEvent {
  calendar: string;
  account: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  busy: boolean;
}

/** Events from every linked account's visible calendars, repeats expanded by Google. */
export async function googleEventsBetween(from: Date, to: Date): Promise<{ events: GEvent[]; errors: string[] }> {
  const events: GEvent[] = [];
  const errors: string[] = [];
  for (const acc of googleAccounts().filter((a) => a.calendar && !a.broken)) {
    try {
      const cals = ((await gcal(acc.email, '/users/me/calendarList?minAccessRole=reader&maxResults=50')).items ?? []).filter((c: any) => c.selected !== false && !c.hidden).slice(0, 12);
      for (const c of cals) {
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
        const items = (await gcal(acc.email, `/calendars/${encodeURIComponent(c.id)}/events?${q}`)).items ?? [];
        for (const e of items) {
          if (e.status === 'cancelled') continue;
          const allDay = !!e.start?.date;
          const start = new Date(allDay ? `${e.start.date}T00:00:00` : e.start?.dateTime);
          const end = new Date(allDay ? `${e.end?.date ?? e.start.date}T00:00:00` : (e.end?.dateTime ?? e.start?.dateTime));
          events.push({ calendar: c.summaryOverride ?? c.summary ?? acc.email, account: acc.email, title: e.summary ?? '(no title)', start, end, allDay, location: e.location, description: e.description?.slice(0, 300), busy: e.transparency !== 'transparent' });
        }
      }
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  return { events, errors };
}

export async function createGoogleEvent(
  email: string,
  ev: { title: string; start: string; end?: string; allDay?: boolean; location?: string; description?: string; calendarId?: string; timeZone?: string },
) {
  const tz = ev.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = ev.allDay
    ? { summary: ev.title, location: ev.location, description: ev.description, start: { date: ev.start.slice(0, 10) }, end: { date: (ev.end ?? ev.start).slice(0, 10) } }
    : {
        summary: ev.title,
        location: ev.location,
        description: ev.description,
        start: { dateTime: ev.start, timeZone: tz },
        end: { dateTime: ev.end ?? new Date(Date.parse(ev.start) + 3600_000).toISOString(), timeZone: tz },
      };
  const r = await gcal(email, `/calendars/${encodeURIComponent(ev.calendarId || 'primary')}/events`, { method: 'POST', body: JSON.stringify(body) });
  return { id: r.id as string, link: r.htmlLink as string };
}
