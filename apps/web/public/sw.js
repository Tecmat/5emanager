// Service worker: cache-first per asset statici (cache versionata con la build), network-first per il resto.
// Supporta l'aggiornamento in-app: il client manda SKIP_WAITING e ricarica.
const CACHE_PREFIX = 'dnd5e-v';
let VERSION = 'dev';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((v) => {
        if (v && v.version) VERSION = v.version;
        return caches.open(CACHE_PREFIX + VERSION).then((c) => c.addAll(ASSETS));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_PREFIX + VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.webmanifest') || url.pathname.startsWith('/icon')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_PREFIX + VERSION).then((c) => c.put(e.request, copy));
        return res;
      })),
    );
  } else {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
  }
});
