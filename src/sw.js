// Custom service worker source (vite-plugin-pwa's "injectManifest" strategy bundles this file
// and replaces self.__WB_MANIFEST with the real precache list at build time). Switched here
// from the auto-generated "generateSW" strategy specifically to add push notification
// handling — generateSW has no hook for custom event listeners like `push`.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Runtime caching for what precaching alone doesn't cover: Google Fonts and live forecast
// data, so a returning visitor with no connection sees the last conditions fetched instead of
// nothing. Plain cache-then-network instead of pulling in workbox-routing/workbox-strategies
// for what's really just two rules.
const RUNTIME_CACHE = 'runtime-v1';
const RUNTIME_CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'marine-api.open-meteo.com', 'api.open-meteo.com'];

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!RUNTIME_CACHEABLE_HOSTS.includes(url.hostname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) cache.put(event.request, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw e;
      }
    })()
  );
});

// The actual point of switching to injectManifest: real push notifications from the
// companion Cloudflare Worker (worker/), delivered while the app isn't even open. The Worker
// sends a JSON payload — see worker/src/push.js's buildNotificationPayload for the shape.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* fall through with {} */ }
  const title = data.title || 'Tideline';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag, // same tag replaces an unread notification instead of stacking duplicates
      data: { url: data.url || './' },
    })
  );
});

// Focus an already-open tab if there is one, rather than always opening a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList.find((c) => c.url === targetUrl || c.url.startsWith(self.registration.scope));
      if (existing) { await existing.focus(); return; }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })()
  );
});

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());
