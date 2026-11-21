import { decide, defaultVerdict, takeDueDigest, type Verdict } from './attention.js';
import { redact } from './safety.js';
import { plainText } from './util.js';
import * as webpush from 'web-push';
import { all, kvGet, kvSet, run } from './db.js';
import { getSettings, type Channel } from './settings.js';
import { emit } from './events.js';
import { id, now } from './util.js';

interface Vapid {
  publicKey: string;
  privateKey: string;
}

function vapid(): Vapid {
  let keys = kvGet<Vapid>('vapid');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    kvSet('vapid', keys);
  }
  return keys;
}

export function initPush() {
  const keys = vapid();
  webpush.setVapidDetails(process.env.SABLE_VAPID_SUBJECT ?? 'mailto:sable-agent@example.com', keys.publicKey, keys.privateKey);
}

export const vapidPublicKey = () => vapid().publicKey;

export function saveSubscription(sub: { endpoint: string }) {
  run('INSERT OR REPLACE INTO push_subs (endpoint, sub, created_at) VALUES (?, ?, ?)', sub.endpoint, JSON.stringify(sub), now());
}
export function removeSubscription(endpoint: string) {
  run('DELETE FROM push_subs WHERE endpoint = ?', endpoint);
}

export interface NotifyInput {
  title: string;
  body?: string;
  link?: string;
  kind?: 'approval' | 'run' | 'agent' | 'schedule' | 'system' | 'watch' | 'hook' | 'reminder' | 'suggestion' | 'done';
  /** Adds Approve / Deny buttons to the push notification (where the browser supports them). */
  approvalId?: string;
  /** How much this deserves your attention (attention.ts). Defaults by kind. */
  verdict?: Verdict;
  /** Who it's from, for your Less / More / Never feedback: "schedule:sch_…", "watch:w_…", "chat:c_…". */
  source?: string;
  /** Same key within a day = the same news; only the first one is told. */
  key?: string;
}

/**
 * Everything that wants to reach the user comes through here. The attention gate decides
 * (attention.ts): nothing, a quiet Inbox entry, the next digest, or a notification now. Only the
 * last one pushes to devices and channels.
 */
export async function notify(input: NotifyInput) {
  input = { ...input, title: plainText(redact(input.title)), body: input.body ? plainText(redact(input.body)) : input.body };
  const kind = input.kind ?? 'agent';
  const d = decide({ verdict: input.verdict ?? defaultVerdict(kind), kind, source: input.source, key: input.key, title: input.title, body: input.body });
  if (d.verdict === 'silent') return null;
  const live = d.verdict === 'tell' || d.verdict === 'urgent';
  const note = { id: id('n_'), title: input.title, body: input.body ?? '', link: input.link ?? '/', kind, read: d.verdict === 'log' ? 1 : 0, created_at: now(), verdict: d.verdict, why: d.why || null, source: input.source ?? null };
  run(
    'INSERT INTO notifications (id, title, body, link, kind, read, created_at, verdict, source, key, pushed, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    note.id, note.title, note.body, note.link, note.kind, note.read, note.created_at, d.verdict, input.source ?? null, input.key ?? null, live ? 1 : 0, d.why || null,
  );
  emit({ type: 'notification', notification: note });
  if (!live) return note;
  await pushOut(note, input.approvalId);
  return note;
}

/** Send to channels and every subscribed device. */
async function pushOut(note: { id: string; title: string; body: string; link: string; kind: string }, approvalId?: string) {
  const important = note.kind === 'approval' || note.kind === 'watch' || note.kind === 'hook' || note.kind === 'agent' || note.kind === 'schedule' || note.kind === 'reminder';
  for (const ch of getSettings().channels.filter((c) => c.enabled && c.events !== 'none' && (c.events === 'all' || important))) {
    void sendToChannel(ch, note.title, note.body, absoluteLink(note.link)).catch((err) => console.error(`[channel ${ch.name}]`, (err as Error).message));
  }

  const subs = all<{ endpoint: string; sub: string }>('SELECT endpoint, sub FROM push_subs');
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(JSON.parse(s.sub), JSON.stringify({ title: note.title, body: note.body, link: note.link, tag: note.kind, approvalId, noteId: note.id }), { TTL: 3600 });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) removeSubscription(s.endpoint);
      }
    }),
  );
}

/** Every minute: if a digest slot has passed (end of quiet hours, 12:30, 18:30), send what's waiting as one notification. */
export function startDigest() {
  const tick = () => {
    try {
      const items = takeDueDigest();
      if (!items.length) return;
      const title = items.length === 1 ? items[0].title : `${items.length} things while you were away`;
      const body = items.length === 1 ? (items[0].body ?? '') : items.slice(0, 6).map((i) => `• ${i.title}`).join('\n') + (items.length > 6 ? `\n+${items.length - 6} more` : '');
      void pushOut({ id: id('n_'), title, body, link: items.length === 1 ? (items[0].link ?? '/inbox') : '/inbox', kind: 'digest' });
    } catch (err) {
      console.error('[digest]', (err as Error).message);
    }
  };
  setInterval(tick, 60_000).unref?.();
  tick();
}

/** Base URL people reach Sable at (configured, or remembered from the last browser visit). */
export function publicBase(): string {
  return (getSettings().publicUrl || process.env.SABLE_PUBLIC_URL || kvGet<string>('lastOrigin') || '').replace(/\/+$/, '');
}
function absoluteLink(link: string) {
  const base = publicBase();
  return base && link.startsWith('/') ? base + link : '';
}

/**
 * Deliver a notification to an outbound channel. These are destinations the user configured
 * themselves, so they use the normal network rather than the agent's (VPN) proxy.
 */
/** A saved output (channel) by name or id. */
export function outputByName(name: string): Channel | undefined {
  const n = name.trim().toLowerCase();
  return getSettings().channels.find((c) => c.id.toLowerCase() === n || c.name.toLowerCase() === n);
}

/** Push to a saved output (by name) or a URL: Discord/Slack/ntfy get their own format, anything else JSON. */
export async function pushTo(target: string, title: string, body: string, data?: Record<string, unknown>) {
  const saved = outputByName(target) ?? getSettings().channels.find((c) => c.url === target);
  if (saved) return sendToChannel(saved, title, body, '', data);
  if (!/^https?:\/\//i.test(target)) throw new Error(`No saved webhook called "${target}".`);
  const type: Channel['type'] = /discord(app)?\.com\/api\/webhooks/.test(target) ? 'discord' : /hooks\.slack\.com/.test(target) ? 'slack' : 'webhook';
  return sendToChannel({ id: 'adhoc', name: 'adhoc', type, url: target, enabled: true, events: 'none' }, title, body, '', data);
}

export async function sendToChannel(ch: Channel, title: string, body: string, link = '', data?: Record<string, unknown>) {
  // Nothing secret leaves through a channel, even if the model echoed it.
  title = redact(title);
  body = redact(body);
  if (data) data = JSON.parse(redact(JSON.stringify(data)));
  const signal = AbortSignal.timeout(10_000);
  let res: Response;
  if (ch.type === 'ntfy') {
    // Title/click as query parameters: they carry UTF-8 safely, unlike HTTP headers.
    const u = new URL(ch.url);
    u.searchParams.set('title', title);
    u.searchParams.set('tags', 'robot');
    if (link) u.searchParams.set('click', link);
    res = await fetch(u, { method: 'POST', headers: ch.token ? { Authorization: `Bearer ${ch.token}` } : {}, body: body || title, signal });
  } else if (ch.type === 'discord') {
    res = await fetch(ch.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: getSettings().persona.name, embeds: [{ title: title.slice(0, 256), description: body.slice(0, 4000), url: link || undefined, color: 0xe3a650 }] }),
      signal,
    });
  } else if (ch.type === 'slack') {
    res = await fetch(ch.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `*${title}*${body ? `\n${body}` : ''}${link ? `\n<${link}|Open in Sable>` : ''}` }),
      signal,
    });
  } else {
    res = await fetch(ch.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ch.token ? { Authorization: `Bearer ${ch.token}` } : {}) },
      body: JSON.stringify({ source: 'sable', title, body, link, ...(data ? { data } : {}), ts: new Date().toISOString() }),
      signal,
    });
  }
  if (!res.ok) throw new Error(`${ch.type} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

