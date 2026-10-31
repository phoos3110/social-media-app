/* The production build replaces this token with a digest of the shipped files. */
const CACHE_NAME = 'po-static-__PO_BUILD__';
const OFFLINE_URL = '/offline.html';
const STATIC_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/po.svg',
  '/icons/po-192.png',
  '/icons/po-512.png',
  '/icons/po-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_URLS)));
  // Updates wait until users close the app or explicitly choose to update.
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('po-static-') && name !== CACHE_NAME) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never intercept private data, uploads, realtime traffic or authenticated API responses.
  if (/^\/(api|socket\.io|uploads)(\/|$)/.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(async () => {
        return (await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME })) || Response.error();
      }),
    );
    return;
  }
  const isBuildAsset =
    url.pathname.startsWith('/assets/') &&
    ['script', 'style', 'font'].includes(request.destination);
  if (!STATIC_URLS.includes(url.pathname) && !isBuildAsset) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        if (keys.length > 80) {
          const removable = keys.filter((key) => new URL(key.url).pathname.startsWith('/assets/'));
          for (const key of removable.slice(0, keys.length - 80)) await cache.delete(key);
        }
      }
      return response;
    })(),
  );
});
