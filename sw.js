// Serve app files from the cache and refresh them in the background.
const VERSION = 'quire-v7';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/util.js', 'js/icons.js', 'js/store.js', 'js/model.js', 'js/ink.js', 'js/paper.js', 'js/stickers.js',
  'js/render.js', 'js/ui.js', 'js/pickers.js', 'js/io.js', 'js/editor.js', 'js/editor-ui.js', 'js/library.js', 'js/main.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
const LATER = ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js'];
const FONTS = 'quire-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(async (c) => {
      await c.addAll(SHELL);
      c.addAll(LATER).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(staleWhileRevalidate(new Request(new URL('index.html', self.registration.scope)), VERSION));
      return;
    }
    e.respondWith(staleWhileRevalidate(req, VERSION));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, FONTS));
  }
});
