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
  kind?: 'approval' | 'run' | 'agent' | 'schedule' | 'system' | 'watch' | 'hook';
}

/** Store an in-app notification, broadcast it live, and send a web push to every subscribed device. */
export async function notify(input: NotifyInput) {
  const note = { id: id('n_'), title: input.title, body: input.body ?? '', link: input.link ?? '/', kind: input.kind ?? 'agent', read: 0, created_at: now() };
  run('INSERT INTO notifications (id, title, body, link, kind, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', note.id, note.title, note.body, note.link, note.kind, note.created_at);
  emit({ type: 'notification', notification: note });

  const important = note.kind === 'approval' || note.kind === 'watch' || note.kind === 'hook' || note.kind === 'agent' || note.kind === 'schedule';
  for (const ch of getSettings().channels.filter((c) => c.enabled && (c.events === 'all' || important))) {
    void sendToChannel(ch, note.title, note.body, absoluteLink(note.link)).catch((err) => console.error(`[channel ${ch.name}]`, (err as Error).message));
  }

  const subs = all<{ endpoint: string; sub: string }>('SELECT endpoint, sub FROM push_subs');
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(JSON.parse(s.sub), JSON.stringify({ title: note.title, body: note.body, link: note.link, tag: note.kind }), { TTL: 3600 });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) removeSubscription(s.endpoint);
      }
    }),
  );
  return note;
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
export async function sendToChannel(ch: Channel, title: string, body: string, link = '') {
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
      body: JSON.stringify({ source: 'sable', title, body, link, ts: new Date().toISOString() }),
      signal,
    });
  }
  if (!res.ok) throw new Error(`${ch.type} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

