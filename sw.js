const CACHE = 'cal-app-v21';
const ASSETS = [
        './',
        './index.html',
        './styles.css?v=9',
        './app.js?v=13',
        './calibration-sync.js?v=2',
        './lib/supabase.js',
        './manifest.json',
        './icon-192.png',
        './icon-512.png',
        './lib/chart.umd.min.js',
        './lib/jspdf.umd.min.js',
        './lib/jspdf.plugin.autotable.min.js',
        './lib/xlsx.full.min.js'
      ];

// How long to wait for the network before opening the page from the
// offline copy (no signal in the field).
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
        // cache: 'reload' skips the browser's HTTP cache, so a new version
        // never gets precached with a stale copy of a file.
        e.waitUntil(caches.open(CACHE).then(c =>
                c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
        self.skipWaiting();
});

self.addEventListener('activate', e => {
        e.waitUntil(
                caches.keys().then(keys =>
                        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
                ).then(() => self.clients.claim())
        );
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
        if (e.request.method !== 'GET') return;

        // The page itself (index.html): network first, so a new deploy shows
        // up on the very next load. index.html names the versioned app.js /
        // styles.css, so those follow automatically. Falls back to the
        // offline copy when there is no signal.
        if (e.request.mode === 'navigate') {
                e.respondWith(pageNetworkFirst(e.request));
                return;
        }

        // Everything else is versioned (?v=N) or a fixed library: cache first.
        e.respondWith(
                caches.match(e.request).then(r => r || fetch(e.request).then(res => {
                        if (res.ok) {
                                const copy = res.clone();
                                caches.open(CACHE).then(c => c.put(e.request, copy));
                        }
                        return res;
                }))
        );
});

async function pageNetworkFirst(request) {
        const cache = await caches.open(CACHE);
        const fromCache = () => cache.match(request, { ignoreSearch: true })
                .then(r => r || cache.match('./index.html'));
        try {
                const res = await Promise.race([
                        fetch(request, { cache: 'no-store' }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS)),
                ]);
                if (res && res.ok) {
                        cache.put('./index.html', res.clone());
                        return res;
                }
                return (await fromCache()) || res;
        } catch (_) {
                const cached = await fromCache();
                return cached || Response.error();
        }
}
