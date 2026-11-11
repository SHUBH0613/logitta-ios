// Logitta Service Worker for Offline-First PWA
const CACHE_NAME = 'logitta-cache-v2.76.6';

const APP_SHELL = [
  './',
  'index.html',
  './index.html',
  'styles.css',
  './styles.css',
  'app.js',
  './app.js',
  'idb-storage.js',
  './idb-storage.js',
  'sync.js',
  './sync.js',
  'manifest.json',
  './manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'favicon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[Service Worker] Caching app shell');
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[Service Worker] Pre-cache skip:', url);
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip sync API calls
  if (url.pathname.includes('/api/sync')) return;

  // Google fonts dynamic cache
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // CACHE-FIRST for everything else (instant offline load)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // If online, update cache in background
        if (navigator.onLine) {
          fetch(req).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResponse));
            }
          }).catch(() => {});
        }
        return cachedResponse;
      }

      // Not in cache yet - fetch from network and cache it
      return fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      }).catch(async () => {
        // When completely offline, fallback to cached index.html for navigation
        if (req.mode === 'navigate') {
          const cache = await caches.open(CACHE_NAME);
          const fallback = (await cache.match('index.html', { ignoreSearch: true }))
                        || (await cache.match('./index.html', { ignoreSearch: true }))
                        || (await cache.match('./', { ignoreSearch: true }));
          if (fallback) return fallback;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
