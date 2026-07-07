const CACHE = 'nutritrack-v5';
const SHELL = ['/', '/index.html', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isAPI = url.hostname.includes('supabase') || url.hostname.includes('anthropic') || url.hostname.includes('usda') || url.hostname.includes('deno.net');
  if (isAPI) return; // let API calls go straight to network, no caching

  // Network-first for the app shell: always get the latest version while
  // online (this app needs a live connection anyway), only fall back to
  // the cache if the network is actually unavailable.
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
