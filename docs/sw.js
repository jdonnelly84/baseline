// Keeps the app opening offline. Always tries the network first, so a new version shows up on the next launch.
const CACHE = 'baseline-202611180405';
const SHELL = ['./', 'app.css?v=202611180405', 'app.js?v=202611180405', 'pwa-loader.js?v=202611180405', 'manifest.webmanifest', 'icon-180.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // Pages lets browsers reuse a page for 10 minutes; ask it to re-check the page itself so updates show at once.
  const req = e.request.mode === 'navigate' ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
