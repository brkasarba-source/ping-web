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
