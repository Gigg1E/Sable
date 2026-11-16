import * as webpush from 'web-push';
import { all, kvGet, kvSet, run } from './db.js';
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
  kind?: 'approval' | 'run' | 'agent' | 'schedule' | 'system';
}

/** Store an in-app notification, broadcast it live, and send a web push to every subscribed device. */
export async function notify(input: NotifyInput) {
  const note = { id: id('n_'), title: input.title, body: input.body ?? '', link: input.link ?? '/', kind: input.kind ?? 'agent', read: 0, created_at: now() };
  run('INSERT INTO notifications (id, title, body, link, kind, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', note.id, note.title, note.body, note.link, note.kind, note.created_at);
  emit({ type: 'notification', notification: note });

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
