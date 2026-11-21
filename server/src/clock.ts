import { kvGet, kvSet } from './db.js';
import { getSettings } from './settings.js';

/**
 * Time, in the user's time zone. The server may sit in UTC or at home while you travel; reminders,
 * routines and everything Sable says about time follow *you*:
 *   1. Settings → General → Time zone, when you set one;
 *   2. otherwise your device's zone, which the app sends with every request (so it follows you when you travel);
 *   3. otherwise the server's zone.
 */

const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function valid(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function userTz(): string {
  const fixed = getSettings().timezone;
  if (valid(fixed)) return fixed;
  const device = kvGet<string>('device_tz');
  return valid(device) ? device : SERVER_TZ;
}

/** Where the current zone comes from, for the prompt and Settings. */
export function tzSource(): 'settings' | 'device' | 'server' {
  if (valid(getSettings().timezone)) return 'settings';
  return valid(kvGet<string>('device_tz')) ? 'device' : 'server';
}

/** Called with the X-Sable-TZ header of every app request. Returns true if it changed. */
export function noteDeviceTz(tz: unknown): boolean {
  if (!valid(tz) || kvGet<string>('device_tz') === tz) return false;
  kvSet('device_tz', tz);
  return true;
}

export interface Parts {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  dow: number; // 0 = Sunday
}

const partFmts = new Map<string, Intl.DateTimeFormat>();
/** The wall-clock date and time at `ts` in the user's zone. */
export function parts(ts: number, tz = userTz()): Parts {
  let f = partFmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    partFmts.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** The instant when the user's wall clock shows this date and time (handles DST). Day overflow is fine. */
export function wallToUtc(y: number, mo: number, d: number, h = 0, mi = 0, tz = userTz()): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const p = parts(t, tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(t / 60_000) * 60_000;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}

/**
 * Read a date-time the model or the user wrote. With an offset or Z, it's exact. Without one
 * ("2026-11-21T22:00", "2026-11-21 22:00"), it's the user's wall-clock time.
 */
export function parseLocal(s: string): number {
  const str = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(str);
  if (m) return wallToUtc(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0)) + (+(m[6] ?? 0)) * 1000;
  return Date.parse(str);
}

/** Formatting in the user's zone. */
export function fmt(ts: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) {
  return new Date(ts).toLocaleString('en-US', { ...opts, timeZone: userTz() });
}
export const fmtTime = (ts: number) => fmt(ts, { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (ts: number) => fmt(ts, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** Whole days from today to `ts`, by the user's calendar. */
export function daysFromToday(ts: number) {
  const a = parts(Date.now());
  const b = parts(ts);
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86_400_000);
}

/** A local ISO string without offset, the format the model should write back. */
export function localIso(ts: number) {
  const p = parts(ts);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** The line at the top of every prompt. */
export function nowLine() {
  const t = Date.now();
  const tz = userTz();
  const src = tzSource() === 'device' ? "from the user's device, so it follows them when they travel" : tzSource() === 'settings' ? 'set by the user' : 'the server’s zone; the user’s device hasn’t reported one yet';
  return `Now, for the user: ${fmt(t, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${tz}, ${src}; local ISO ${localIso(t)}).
All times you read from tools and all times you write are the user's local time. Write date-times WITHOUT an offset (e.g. ${localIso(t).slice(0, 10)}T22:00); Sable converts them. Never mention server time or UTC to the user.`;
}
