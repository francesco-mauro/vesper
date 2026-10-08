// Service worker: makes Vesper installable and usable offline.
//
// All app files are one unit. They are cached together when the worker
// installs, answered from the cache afterwards, and refreshed together when the
// page asks: the page sends 'refresh' after it has loaded, the worker fetches
// every file fresh, and only if all of them arrive does it replace the cache.
// A failed or half-finished update therefore leaves the old, consistent copy
// in place, so a visitor never gets a mix of old and new files.
//
// A deploy reaches people on the visit after the one that downloaded it.
// Change CACHE only when the SHELL list changes, to retire the old cache.
//
// Contents
// - CACHE and the SHELL file list
// - refreshShell: fetch everything, then store everything
// - install, activate, message ('refresh') and fetch handlers

const CACHE = 'vesper-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/tokens.css',
  'styles/app.css',
  'src/main.js',
  'src/dom.js',
  'src/state.js',
  'src/storage.js',
  'src/schema.js',
  'src/seed.js',
  'src/stats.js',
  'src/picker.js',
  'src/dates.js',
  'src/views/tonight.js',
  'src/views/menu.js',
  'src/views/week.js',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/apple-touch-icon.png',
  'assets/fonts/young-serif.woff2',
];

const absolute = (path) => new URL(path, self.registration.scope).href;

// Query strings and fragments never change which file it is.
const keyFor = (url) => {
  const key = new URL(url);
  key.search = '';
  key.hash = '';
  return key.href;
};

/** Fetch every app file fresh, then store them all, or store nothing. */
async function refreshShell() {
  const fetched = await Promise.all(
    SHELL.map(async (path) => {
      // cache: 'reload' skips the browser's HTTP cache, which GitHub Pages fills for ten minutes.
      const response = await fetch(new Request(absolute(path), { cache: 'reload' }));
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return [absolute(path), response];
    }),
  );
  const cache = await caches.open(CACHE);
  await Promise.all(fetched.map(([key, response]) => cache.put(key, response)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('vesper-') && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'refresh') event.waitUntil(refreshShell().catch(() => {}));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(keyFor(request.url));
        if (cached) return cached;
      } catch {
        // A broken cache must never break the app: go to the network.
      }
      try {
        return await fetch(request);
      } catch {
        if (request.mode === 'navigate') {
          const shell = await caches.match(absolute('index.html'));
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
