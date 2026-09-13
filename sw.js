const CACHE = 'cal-app-v11';
const ASSETS = [
        './',
        './index.html',
        './styles.css',
        './app.js?v=8',
        './calibration-sync.js',
        './manifest.json',
        './icon-192.png',
        './icon-512.png',
        './lib/chart.umd.min.js',
        './lib/jspdf.umd.min.js',
        './lib/jspdf.plugin.autotable.min.js',
        './lib/xlsx.full.min.js'
      ];

self.addEventListener('install', e => {
        e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
        self.skipWaiting();
});

self.addEventListener('activate', e => {
        e.waitUntil(
                  caches.keys().then(keys =>
                              Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
                                         )
                );
        self.clients.claim();
});

self.addEventListener('fetch', e => {
        const url = new URL(e.request.url);

                        // Only ever cache this app's own same-origin files. Cross-origin
                        // requests (Supabase API/storage calls in particular) must always hit
                        // the network directly -- caching a query result by URL would mean an
                        // "instrument not found" lookup made before that instrument existed
                        // gets served back forever, even after the real data shows up.
                        if (url.origin !== self.location.origin) {
                                  return;
                        }

                        e.respondWith(
                                  caches.match(e.request).then(r => r || fetch(e.request).then(res => {
                                              if (e.request.method === 'GET' && res.ok) {
                                                            const copy = res.clone();
                                                            caches.open(CACHE).then(c => c.put(e.request, copy));
                                              }
                                              return res;
                                  }).catch(() => caches.match('./index.html')))
                                );
});
