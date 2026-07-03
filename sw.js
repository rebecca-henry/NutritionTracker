const CACHE = 'nutritrack-v1';
const SHELL = ['/', '/index.html', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for shell
  const url = new URL(e.request.url);
  const isAPI = url.hostname.includes('supabase') || url.hostname.includes('anthropic') || url.hostname.includes('usda');
  if (isAPI) return; // let API calls go straight to network, no caching
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }))
  );
});
