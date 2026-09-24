const SHELL_CACHE = 'mangasketcher-shell-v14';
const NETWORK_TIMEOUT_MS = 4000;
const BASE_PATH = '';

function withBase(path) {
  if (!BASE_PATH) {
    return path;
  }
  if (path === '/') {
    return `${BASE_PATH}/`;
  }
  return `${BASE_PATH}${path}`;
}

const PRECACHE_PATHS = [
  '/',
  '/p/',
  '/page_template.jpg',
  '/pdf.worker.min.mjs',
  '/sql-wasm-browser.wasm',
  '/manifest.webmanifest',
].map(withBase);

function shouldPrecache(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return false;
  }
  if (
    path === withBase('/sw.js') ||
    path === withBase('/serve.json') ||
    path === withBase('/.nojekyll') ||
    path === withBase('/p')
  ) {
    return false;
  }
  if (path.startsWith('/api/') || (BASE_PATH && path.startsWith(`${BASE_PATH}/api/`))) {
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
    const manifest = await fetchWithTimeout(withBase('/precache-manifest.json'), NETWORK_TIMEOUT_MS, {
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
      ),
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
  const home = withBase('/');
  const homeBare = BASE_PATH || '/';
  if (path === home || path === homeBare || path === '') {
    return [home];
  }
  const editorSlash = withBase('/p/');
  if (path === withBase('/p') || path === editorSlash) {
    return [editorSlash];
  }
  return [];
}

function isUsableResponse(response) {
  return Boolean(response && response.ok && response.type !== 'opaqueredirect' && !response.redirected);
}

async function fetchPage(url) {
  const response = await fetchWithTimeout(url, NETWORK_TIMEOUT_MS, {
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!isUsableResponse(response)) {
    if (!response || response.type === 'opaqueredirect' || !response.ok) {
      return null;
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}

function bypassServiceWorker(url) {
  return (
    url.pathname === withBase('/sw.js') ||
    url.pathname === withBase('/precache-manifest.json') ||
    url.pathname.startsWith('/api/') ||
    (BASE_PATH !== '' && url.pathname.startsWith(`${BASE_PATH}/api/`))
  );
}

function offlineResponse() {
  return new Response('オフラインです', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function cachedPage(cacheKeys) {
  const cache = await caches.open(SHELL_CACHE);
  for (const key of cacheKeys) {
    const cached = await cache.match(key);
    if (isUsableResponse(cached)) {
      return cached;
    }
  }
  const home = await cache.match(withBase('/'));
  if (isUsableResponse(home)) {
    return home;
  }
  return null;
}

async function respondCacheFirst(request, cacheKeys) {
  const cache = await caches.open(SHELL_CACHE);
  for (const key of cacheKeys) {
    const cached = await cache.match(key);
    if (isUsableResponse(cached)) {
      return cached;
    }
  }
  const cachedRequest = await cache.match(request);
  if (isUsableResponse(cachedRequest)) {
    return cachedRequest;
  }
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (isUsableResponse(response)) {
      const copy = response.clone();
      const putKey = cacheKeys[0] ?? request;
      void cache.put(putKey, copy);
      return response;
    }
  } catch {
    // Fall through to the cached shell.
  }
  return (await cachedPage(cacheKeys)) ?? offlineResponse();
}

async function respondProjectNavigation(url, cacheKeys) {
  try {
    const response = await fetchPage(url.href);
    if (response) {
      return response;
    }
  } catch {
    // Offline: serve the cached editor shell.
  }
  return (await cachedPage(cacheKeys)) ?? offlineResponse();
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
    event.respondWith(respondProjectNavigation(url, keys));
    return;
  }

  event.respondWith(respondCacheFirst(request, []));
});
