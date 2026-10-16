// Service worker of the panel (D049): Web Push only (no offline cache). Shows the notice the API
// sends ("rota nova" for the courier) and opens the page of the notice on a tap.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aviso', {
      body: data.body || '',
      tag: data.tag,
      // A new notice of the same route replaces the old one and still alerts.
      renotify: Boolean(data.tag),
      icon: '/brand/favicon.svg',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.navigate(url).then((c) => (c ?? client).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
