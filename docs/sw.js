// Keeps the app opening offline. Always tries the network first, so a new version shows up on the next launch.
const CACHE = 'baseline-202611190021';
const SHELL = ['./', 'app.css?v=202611190021', 'app.js?v=202611190021', 'pwa-loader.js?v=202611190021', 'manifest.webmanifest', 'icon-180.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // Pages lets browsers reuse a page for 10 minutes; ask it to re-check the page itself so updates show at once.
  const req = e.request.mode === 'navigate' ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
// Notifications sent by the updater on the computer (Web Push). iPhone requires every push to show a notification.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Baseline', { body: d.body || '', tag: d.tag || undefined, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
