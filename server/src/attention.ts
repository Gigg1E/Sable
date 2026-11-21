import { all, get, kvGet, kvSet, run } from './db.js';
import { getSettings } from './settings.js';
import { parts, wallToUtc } from './clock.js';

/**
 * Attention: the only door to the user (docs/design/autonomy.md §3).
 *
 * Everything that wants to reach you arrives here with a verdict:
 *   silent  nothing to say; not even listed
 *   log     worth keeping, not worth a ping (listed quietly in the Inbox)
 *   digest  bundled into the next digest (end of quiet hours, 12:30, 18:30)
 *   tell    a notification now (moves to the digest in quiet hours or past the hourly limit)
 *   urgent  now, even in quiet hours (approvals, reminders you set yourself)
 *
 * Then your feedback on that source (Less / More / Never), deduplication and quiet hours adjust it.
 * The result decides whether push.ts actually sends anything.
 */

export type Verdict = 'silent' | 'log' | 'digest' | 'tell' | 'urgent';
const RANK: Verdict[] = ['silent', 'log', 'digest', 'tell', 'urgent'];
export const isVerdict = (v: unknown): v is Verdict => typeof v === 'string' && (RANK as string[]).includes(v);

export interface AttentionSettings {
  quietStart: string; // "23:00", user's local time
  quietEnd: string; // "07:00"
  /** Most "tell" pings per hour; the rest go to the digest. */
  maxPerHour: number;
  /** Local times the digest goes out (besides the end of quiet hours). */
  digestTimes: string[];
}
export const defaultAttention = (): AttentionSettings => ({ quietStart: '23:00', quietEnd: '07:00', maxPerHour: 6, digestTimes: ['12:30', '18:30'] });
const cfg = (): AttentionSettings => ({ ...defaultAttention(), ...(getSettings().attention ?? {}) });

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Whether it's quiet hours right now, in the user's time zone. */
export function isQuiet(at = Date.now()): boolean {
  const { quietStart, quietEnd } = cfg();
  if (quietStart === quietEnd) return false;
  const p = parts(at);
  const m = p.h * 60 + p.mi;
  const a = hm(quietStart), b = hm(quietEnd);
  return a < b ? m >= a && m < b : m >= a || m < b;
}

// ── Feedback per source: -2 never, -1 less, 0 as is, +1 more ──

export function sourceLevel(source: string | undefined): number {
  if (!source) return 0;
  return get<{ level: number }>('SELECT level FROM attention_prefs WHERE source = ?', source)?.level ?? 0;
}
export function setSourceLevel(source: string, level: number, label: string) {
  run(
    'INSERT INTO attention_prefs (source, level, label, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET level = excluded.level, label = excluded.label, updated_at = excluded.updated_at',
    source, Math.max(-2, Math.min(1, level)), label.slice(0, 200), Date.now(),
  );
}
export function listSourcePrefs() {
  return all<{ source: string; level: number; label: string; updated_at: number }>('SELECT * FROM attention_prefs WHERE level != 0 ORDER BY updated_at DESC');
}

const norm = (s: string) => s.toLowerCase().replace(/\d{1,2}:\d{2}\s*(am|pm)?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export interface Decision {
  verdict: Verdict;
  /** Why it ended up here, shown in the Inbox ("held for quiet hours", "you said less like this"). */
  why: string;
}

/** Decide what actually happens to something that wants your attention. */
export function decide(input: { verdict: Verdict; kind: string; source?: string; key?: string; title: string; body?: string }): Decision {
  let v = input.verdict;
  let why = '';
  if (input.kind === 'approval') return { verdict: 'urgent', why: '' };

  // Your feedback on this source.
  const level = sourceLevel(input.source);
  if (level === -2 && v !== 'urgent') return { verdict: 'log', why: 'you said never for this' };
  if (level === -1 && (v === 'tell' || v === 'digest')) {
    v = v === 'tell' ? 'digest' : 'log';
    why = 'you said less like this';
  }
  if (level === 1 && v === 'digest') {
    v = 'tell';
    why = 'you said more like this';
  }
  if (v === 'silent' || v === 'log') return { verdict: v, why };

  // Never the same thing twice: same key, or the same words, within a day.
  const since = Date.now() - 24 * 3600_000;
  const dupe = input.key
    ? get('SELECT id FROM notifications WHERE key = ? AND created_at > ? AND verdict IN (\'digest\', \'tell\', \'urgent\') LIMIT 1', input.key, since)
    : all<{ title: string; body: string | null }>("SELECT title, body FROM notifications WHERE created_at > ? AND verdict IN ('digest', 'tell', 'urgent') ORDER BY created_at DESC LIMIT 50", since).find(
        (n) => norm(`${n.title} ${n.body ?? ''}`) === norm(`${input.title} ${input.body ?? ''}`),
      );
  if (dupe) return { verdict: 'log', why: 'already told you' };

  if (v === 'urgent') return { verdict: v, why };
  if (v === 'tell' && isQuiet()) return { verdict: 'digest', why: 'held for quiet hours' };
  if (v === 'tell') {
    const recent = get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE verdict IN ('tell', 'urgent') AND kind != 'approval' AND created_at > ?", Date.now() - 3600_000)?.n ?? 0;
    if (recent >= cfg().maxPerHour) return { verdict: 'digest', why: 'bundled: lots happening this hour' };
  }
  return { verdict: v, why };
}

/** A sensible verdict when the caller didn't give one. */
export function defaultVerdict(kind: string): Verdict {
  if (kind === 'approval' || kind === 'reminder') return 'urgent';
  return 'tell';
}

// ── Digest ──

/** The most recent digest slot at or before now: the end of quiet hours, or one of the digest times. */
function lastSlot(at = Date.now()): number {
  const p = parts(at);
  const times = [cfg().quietEnd, ...cfg().digestTimes];
  let best = 0;
  for (const back of [0, 1]) {
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const ts = wallToUtc(p.y, p.mo, p.d - back, h || 0, m || 0);
      if (ts <= at && ts > best) best = ts;
    }
  }
  return best;
}

export interface DigestItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
}

/** Items waiting for the digest, if it's time to send them; marks them sent. */
export function takeDueDigest(at = Date.now()): DigestItem[] {
  if (isQuiet(at)) return [];
  const slot = lastSlot(at);
  if ((kvGet<number>('digest_last') ?? 0) >= slot) return [];
  const items = all<DigestItem>("SELECT id, title, body, link FROM notifications WHERE verdict = 'digest' AND pushed = 0 AND created_at < ? ORDER BY created_at", at);
  kvSet('digest_last', at);
  if (items.length) run(`UPDATE notifications SET pushed = 1 WHERE id IN (${items.map(() => '?').join(',')})`, ...items.map((i) => i.id));
  return items;
}

/** Pending digest items (for the morning rundown and the Inbox). */
export function pendingDigest(): DigestItem[] {
  return all<DigestItem>("SELECT id, title, body, link FROM notifications WHERE verdict = 'digest' AND pushed = 0 ORDER BY created_at");
}

export const verdictRank = (v: Verdict) => RANK.indexOf(v);
