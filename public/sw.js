self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
  );
});
