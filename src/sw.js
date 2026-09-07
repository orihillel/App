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

// The vector coastline, kept cache-first rather than precached.
//
// It is 3.0MB on disk and 807KB over the wire, and it is deliberately left out of the
// precache list (see vite.config.js) because most sessions never open the globe and tripling
// the install payload for all of them would be a poor trade. But the opposite extreme is what
// it had: nothing cached it either, so every cold cache paid the 807KB again and the globe
// simply did not work offline. Fetched once, kept from then on, is the right middle.
//
// Cache-first, not network-first, and only safe because the filename carries its version: the
// -v2 suffix exists precisely because an earlier build changed this file's contents at a stable
// URL and every cached copy silently kept serving the old shape. New contents mean a new name.
const IMMUTABLE_ASSET = /\/coastline-[\w-]+\.json$/;

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && IMMUTABLE_ASSET.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const fresh = await fetch(event.request);
        if (fresh.ok) cache.put(event.request, fresh.clone());
        return fresh;
      })()
    );
    return;
  }

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
  const title = data.title || 'Surfcast';
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
