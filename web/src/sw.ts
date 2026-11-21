/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// App shell for every in-app route; the API is never cached.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; link?: string; tag?: string; approvalId?: string; noteId?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Sable', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Sable', {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: data.tag === 'approval' ? undefined : data.tag,
      data: { link: data.link ?? '/', approvalId: data.approvalId, noteId: data.noteId },
      // Approve right from the notification (Android, Windows, macOS Chrome; iOS opens the app instead).
      ...(data.approvalId
        ? {
            actions: [
              { action: 'approve', title: 'Approve' },
              { action: 'deny', title: 'Deny' },
            ],
            requireInteraction: true,
          }
        : data.noteId && data.tag !== 'digest' && data.tag !== 'system'
          ? {
              // Tune it right from the notification: future ones from the same source get quieter.
              actions: [
                { action: 'less', title: 'Less like this' },
                { action: 'never', title: 'Never' },
              ],
            }
          : {}),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const approvalId = event.notification.data?.approvalId as string | undefined;
  if (approvalId && (event.action === 'approve' || event.action === 'deny')) {
    event.waitUntil(
      (async () => {
        const res = await fetch(`/api/approvals/${approvalId}/decision`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: event.action }),
        }).catch(() => null);
        if (!res?.ok) {
          // Signed out or expired: open the app so it can be handled there.
          await self.clients.openWindow((event.notification.data?.link as string) ?? '/inbox');
          return;
        }
        await self.registration.showNotification(event.action === 'approve' ? 'Approved' : 'Denied', { body: event.notification.title.replace(/^Approve:\s*/, ''), icon: '/icon-192.png', badge: '/badge-96.png', tag: 'decision' });
        setTimeout(() => void self.registration.getNotifications({ tag: 'decision' }).then((ns) => ns.forEach((n) => n.close())), 4000);
      })(),
    );
    return;
  }
  const noteId = event.notification.data?.noteId as string | undefined;
  if (noteId && (event.action === 'less' || event.action === 'never')) {
    event.waitUntil(
      fetch(`/api/notifications/${noteId}/feedback`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: event.action }),
      }).catch(() => null),
    );
    return;
  }
  const link = (event.notification.data?.link as string) ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if ('focus' in w) {
          await w.focus();
          w.postMessage({ type: 'navigate', link });
          return;
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
