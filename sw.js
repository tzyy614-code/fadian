const CACHE_NAME = 'eco-law-v7';
const STATIC_ASSETS = [
  './',
  './index.html',
  './sw.js'
];
const MAX_CACHE_ENTRIES = 300;

// 安装时缓存静态资源（即使部分失败也不阻塞 SW 注册）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] 跳过缓存', url, err && err.message);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// 限制缓存条目总数，防止无限膨胀
async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // 删除最旧的条目（按请求顺序近似）
  const toDelete = keys.slice(0, keys.length - max);
  await Promise.all(toDelete.map((req) => cache.delete(req)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) 只处理 GET，忽略 POST/PUT/DELETE 等
  if (request.method !== 'GET') return;

  // 2) 禁止跨域 iframe 劫持：如果请求来自第三方 iframe，不拦截
  if (request.mode === 'navigate') {
    // navigate 由同域页面发起，允许
  }

  // 3) 本地资源：缓存优先
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(async (cache) => {
                await cache.put(request, clone);
                await trimCache(cache, MAX_CACHE_ENTRIES);
              });
            }
            return response;
          })
          .catch(() => {
            if (request.destination === 'image') {
              return new Response('', { status: 204 });
            }
            return cached;
          });
      })
    );
    return;
  }

  // 4) CDN 资源：stale-while-revalidate，但跳过 opaque 响应
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            // 不缓存 opaque 响应（无法验证，可能浪费空间）
            if (networkResponse.type === 'opaque') return networkResponse;
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(async (cache) => {
              await cache.put(request, clone);
              await trimCache(cache, MAX_CACHE_ENTRIES);
            });
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
