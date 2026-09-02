// Flomemos Service Worker —— 免费档；不引入额外依赖
// 策略：
//   - /vendor/* 和 /assets/* 走 stale-while-revalidate（命中缓存立即返回，后台刷新）
//   - /api/* 与其他 GET 请求走 network-first（断网时回退缓存）

const VERSION = 'fm-sw-v1';
const CACHE_STATIC = `${VERSION}-static`;

const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/assets/favicon.svg',
  '/assets/style.css',
  '/assets/app.js',
  '/assets/editor.js',
  '/assets/api.js',
  '/assets/md.js',
  '/assets/i18n.js',
  '/vendor/marked.min.js',
  '/vendor/purify.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 不缓存写操作
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 静态资源：SWR
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/vendor/')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // API 与页面：network-first
  if (url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 其它资源：尝试缓存
  event.respondWith(staleWhileRevalidate(req));
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}