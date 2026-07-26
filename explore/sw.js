/*
 * 떠나 코스 탐색 미니 웹앱 서비스워커
 * 범위: /explore/ (랜딩·코스 공유 페이지에는 관여하지 않음)
 *  - 셸(HTML·아이콘): 캐시 우선 + 백그라운드 갱신
 *  - 탐색 API: 네트워크 우선, 오프라인 시 마지막 응답 폴백
 *  - 썸네일(/uploads/): 캐시 우선(최대 80장, 오래된 것부터 정리)
 */
'use strict';

const VERSION = 'explore-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const IMG_CACHE = `${VERSION}-img`;
const IMG_LIMIT = 80;

const SHELL = [
  '/explore/',
  '/explore/manifest.json',
  '/tteona-logo.png?v=2',
  '/tteoni-front.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 폰트 등 외부는 브라우저 기본 동작

  // 탐색 API — 네트워크 우선, 실패 시 캐시 폴백 (오프라인에서도 마지막 목록 표시)
  if (url.pathname === '/api/public/explore') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 다른 API는 캐시하지 않는다 (인증·실시간 데이터)
  if (url.pathname.startsWith('/api/')) return;

  // 썸네일·아바타 이미지 — 캐시 우선
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(IMG_CACHE).then((c) => c.put(req, copy).then(() => trimCache(IMG_CACHE, IMG_LIMIT)));
          }
          return res;
        });
      })
    );
    return;
  }

  // 셸 내비게이션·정적 파일 — 캐시 우선 + 백그라운드 갱신 (stale-while-revalidate)
  const isShellNav = req.mode === 'navigate' && url.pathname.startsWith('/explore');
  const isShellAsset = SHELL.includes(url.pathname);
  if (isShellNav || isShellAsset || url.pathname.startsWith('/explore/')) {
    const cacheKey = isShellNav ? '/explore/' : req;
    e.respondWith(
      caches.match(cacheKey).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(cacheKey, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
