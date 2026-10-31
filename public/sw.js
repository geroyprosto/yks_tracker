// No private API, authenticated page or personal record is cached.
const CACHE = 'yksim-shell-v2';
const RETRY_DELAYS = [300, 1000];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(['/offline.html', '/icon-192.png', '/icon-512.png']))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys
      .filter(key => key.startsWith('yksim-shell-') && key !== CACHE)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function navigate(request) {
  for (let attempt = 0; ; attempt++) {
    try {
      // A connection waking from idle can fail once while the device is online.
      // Retry transport failures only; HTTP error responses belong to the app.
      return await fetch(request, attempt === 0 ? undefined : {cache: 'no-store'});
    } catch (error) {
      if (self.navigator.onLine === false || attempt === RETRY_DELAYS.length) {
        const cache = await caches.open(CACHE);
        const offline = await cache.match('/offline.html');
        if (offline) return offline;
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never replay writes or one-time authentication callbacks.
  if (request.mode !== 'navigate' || request.method !== 'GET' ||
      url.origin !== self.location.origin || /^\/(api|auth)(\/|$)/.test(url.pathname)) return;
  event.respondWith(navigate(request));
});

