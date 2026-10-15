// 앱 셸 오프라인 캐시 (덱 데이터는 IndexedDB에 있고 여기엔 없음)
const CACHE = 'flashdeck-v1';
const ASSETS = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './js/app.js', './js/dom.js', './js/db.js', './js/sched.js', './js/importer.js', './js/types.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 캐시 우선 + 백그라운드 갱신 (오프라인에서도 즉시 열림, 새 버전은 다음 실행에 반영)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }),
  );
});
