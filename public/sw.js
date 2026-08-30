const SHELL_CACHE = 'mangasketcher-shell-v10';
const PRECACHE_PATHS = ['/', '/p', '/p/', '/page_template.jpg', '/pdf.worker.min.mjs'];

async function fillPrecache(cache) {
  try {
    const manifest = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (!manifest.ok) {
      return;
    }
    const extra = await manifest.json();
    if (!Array.isArray(extra)) {
      return;
    }
    await Promise.all(extra.map((path) => cache.add(path).catch(() => undefined)));
  } catch {
    // Runtime caching still fills the shell as the user navigates.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(PRECACHE_PATHS.map((path) => cache.add(path).catch(() => undefined))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => caches.open(SHELL_CACHE))
      .then((cache) => fillPrecache(cache)),
  );
});

function navigationCacheKeys(url) {
  const path = url.pathname;
  if (path === '/' || path === '') {
    return ['/'];
  }
  if (path === '/p' || path === '/p/') {
    return ['/p', '/p/'];
  }
  return [];
}

function isShellAsset(url) {
  if (url.pathname === '/sw.js') {
    return false;
  }
  return (
    url.pathname === '/page_template.jpg' ||
    url.pathname === '/pdf.worker.min.mjs' ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    const keys = navigationCacheKeys(url);
    if (keys.length === 0) {
      return;
    }
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(keys[0], copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          for (const key of keys) {
            const cached = await cache.match(key);
            if (cached) {
              return cached;
            }
          }
          return (
            (await cache.match('/')) ||
            new Response('オフラインです', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }),
    );
    return;
  }

  if (!isShellAsset(url)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
