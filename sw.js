/*
 * Ping service worker.
 *
 * Yalnizca uygulamanin kendi dosyalarini (ayni adres) onbellege aliyor;
 * Supabase ve LiveKit isteklerine hic dokunmuyor.
 *
 *  - Sayfa (index.html): once agdan, ag yoksa onbellekten. Boylece yeni
 *    surum yayinlandiginda bir sonraki acilista hemen geliyor.
 *  - assets/ altindaki dosyalar: adlarinda icerik ozeti (hash) var,
 *    hic degismiyorlar; onbellekten veriliyor.
 */
// Onbellek adi degismedi: yeni surum icin sayfa zaten agdan geliyor.
// Bu dosyanin degismesi (push dinleyicileri) tarayicinin yeni service
// worker'i kurmasina yetiyor (skipWaiting + clients.claim).
const CACHE = 'ping-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) {
            cache.put('./', res.clone());
            // Eski surumun assets dosyalarini temizle (yeni sayfa artik
            // onlari istemiyor). Onbellek surum surum sismesin.
            pruneAssets(cache, await res.clone().text());
          }
          return res;
        } catch {
          return (await cache.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});

/*
 * Telefon bildirimi (web push, 0.6.0). Gonderen: supabase/functions/
 * push-notify. Govde: { title, body, tag, open: { dm | channel+server | call } }.
 *
 * Her push'ta bildirim gosteriliyor: iPhone, bildirim gostermeyen
 * push'larda izni bir sure sonra geri aliyor. Ayni konusmanin
 * bildirimleri `tag` ile ust uste biniyor (yigilmiyor); uygulamanin
 * kendi (acikken) bildirimleri de ayni tag'i kullandigi icin cift cikmiyor.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Ping', body: event.data ? event.data.text() : '' };
  }
  const isCall = Boolean(data.open && data.open.call);
  event.waitUntil(
    self.registration.showNotification(data.title || 'Ping', {
      body: data.body || '',
      tag: data.tag || 'ping',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      // Arama kullanici dokunana kadar ekranda kalsin (destekleyen yerde).
      requireInteraction: isCall,
      vibrate: isCall ? [300, 150, 300, 150, 300] : [120],
      data: { open: data.open || {} },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const open = (event.notification.data && event.notification.data.open) || {};
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins[0];
      if (win) {
        // Acik uygulamaya "surayi ac" de, one getir.
        win.postMessage({ type: 'ping-open', open });
        return win.focus();
      }
      // Kapaliysa adres cubugu uzerinden (#open=...) ac; uygulama
      // acilista bunu okuyor (Workspace).
      const url = new URL('./', self.registration.scope);
      url.hash = `open=${encodeURIComponent(JSON.stringify(open))}`;
      return self.clients.openWindow(url.href);
    })(),
  );
});

async function pruneAssets(cache, html) {
  try {
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (!path.includes('/assets/')) continue;
      const name = path.split('/').pop();
      if (!html.includes(name)) await cache.delete(req);
    }
  } catch {
    /* onemsiz */
  }
}
