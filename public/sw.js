const SHELL_CACHE = 'mangasketcher-shell-v13';
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE_PATHS = [
  '/',
  '/p',
  '/p/',
  '/page_template.jpg',
  '/pdf.worker.min.mjs',
  '/sql-wasm-browser.wasm',
  '/manifest.webmanifest',
];

function shouldPrecache(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return false;
  }
  if (path === '/sw.js' || path === '/serve.json' || path === '/.nojekyll') {
    return false;
  }
  if (path.startsWith('/api/')) {
    return false;
  }
  return true;
}

function fetchWithTimeout(resource, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(resource, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

async function cachePutWithTimeout(cache, path) {
  try {
    const response = await fetchWithTimeout(path, NETWORK_TIMEOUT_MS);
    if (response && response.ok) {
      await cache.put(path, response);
    }
  } catch {
    // Ignore; runtime caching still fills as the user navigates.
  }
}

async function fillPrecache(cache) {
  try {
    const manifest = await fetchWithTimeout('/precache-manifest.json', NETWORK_TIMEOUT_MS, {
      cache: 'no-store',
    });
    if (!manifest.ok) {
      return;
    }
    const extra = await manifest.json();
    if (!Array.isArray(extra)) {
      return;
    }
    await Promise.all(extra.filter(shouldPrecache).map((path) => cachePutWithTimeout(cache, path)));
  } catch {
    // Runtime caching still fills the shell as the user navigates.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all(PRECACHE_PATHS.map((path) => cachePutWithTimeout(cache, path))).then(() =>
          fillPrecache(cache),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => caches.open(SHELL_CACHE))
      .then((cache) => fillPrecache(cache))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

function bypassServiceWorker(url) {
  return (
    url.pathname === '/sw.js' ||
    url.pathname === '/precache-manifest.json' ||
    url.pathname.startsWith('/api/')
  );
}

async function respondCacheFirst(request, cacheKeys) {
  const cache = await caches.open(SHELL_CACHE);
  for (const key of cacheKeys) {
    const cached = await cache.match(key);
    if (cached) {
      return cached;
    }
  }
  const cachedRequest = await cache.match(request);
  if (cachedRequest) {
    return cachedRequest;
  }
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response && response.ok) {
      const copy = response.clone();
      const putKey = cacheKeys[0] ?? request;
      void cache.put(putKey, copy);
    }
    return response;
  } catch {
    return (
      (await cache.match('/')) ||
      new Response('オフラインです', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
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
  if (bypassServiceWorker(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    const keys = navigationCacheKeys(url);
    if (keys.length === 0) {
      return;
    }
    event.respondWith(respondCacheFirst(request, keys));
    return;
  }

  event.respondWith(respondCacheFirst(request, []));
});
