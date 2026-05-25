self.addEventListener('install', event => {
  console.log('[SW] install');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('[SW] activate');
  event.waitUntil(
    clients.claim().then(() => {
      console.log('[SW] clients claimed');
    })
  );
});

self.addEventListener('fetch', event => {
  console.log('[SW] fetch', event.request.method, event.request.url);
  event.respondWith(
    fetch(event.request).catch(err => {
      console.error('[SW] fetch error', err);
      throw err;
    })
  );
});
