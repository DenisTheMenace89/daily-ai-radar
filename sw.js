const CACHE_NAME = 'daily-ai-radar-v9';
const ASSETS = ['./', './index.html', './manifest.webmanifest?v=9', './icon-192.png?v=9', './icon-512.png?v=9', './apple-touch-icon.png?v=9'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => undefined)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('/briefings.json') || url.pathname.endsWith('/manifest.webmanifest')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
