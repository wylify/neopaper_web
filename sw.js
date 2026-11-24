// Offline-first: every file the app needs is cached on install. Bump VERSION on each release
// (and APP_VERSION in js/config.js) so installed copies pick up the new files.
const VERSION = 'neopaper-web-1.4.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/builder.js', './js/capacity.js', './js/code128.js', './js/codes.js', './js/colorpicker.js',
  './js/colors.js', './js/config.js', './js/editors.js', './js/export.js', './js/home.js', './js/install.js',
  './js/model.js', './js/nav.js', './js/np1.js', './js/parse.js', './js/photo.js', './js/placement.js', './js/previews.js', './js/qr.js',
  './js/render.js', './js/scan.js', './js/settings.js', './js/sheet.js', './js/state.js', './js/store.js', './js/ui.js',
  './vendor/zxing/zxing-reader.js', './vendor/zxing/zxing_reader.wasm',
  './fonts/space_grotesk.ttf', './fonts/jetbrains_mono.ttf',
  './fonts/warn_hanzi.ttf', './fonts/warn_kana.ttf', './fonts/warn_cyrillic.ttf', './fonts/warn_hangul.ttf',
  './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // The app's own page always gets the cached shell, whatever query it carried (?open=scan).
    const path = new URL(req.url).pathname, root = new URL('./', location.href).pathname;
    const isShell = req.mode === 'navigate' && (path === root || path === root + 'index.html');
    const hit = isShell ? await cache.match('./') : await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (isShell) { const shell = await cache.match('./'); if (shell) return shell; }
      throw err;
    }
  })());
});
