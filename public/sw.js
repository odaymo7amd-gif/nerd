/* عامل خدمة نيرد: تخزين هيكل التطبيق والأصول الثابتة فقط.
   طلبات /api لا تُخزَّن أبدًا لأنها تحتوي بيانات مستخدم. */
const CACHE = 'nerd-shell-v1';
const OFFLINE = '/offline.html';
const PRECACHE = [
  OFFLINE,
  '/manifest.webmanifest',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE).then((cached) => cached ?? new Response('لا يوجد اتصال بالإنترنت.', { status: 503 })),
      ),
    );
    return;
  }

  // أصول ثابتة: الشبكة أولًا مع تحديث الكاش، ثم الكاش عند الانقطاع.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && ['style', 'script', 'image', 'font'].includes(request.destination)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
