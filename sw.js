/* Service worker: precarga la app y los datos para funcionar sin cobertura.
   Al cambiar cualquier fichero (sobre todo data/viaje.json), subir VERSION. */
const VERSION = 'v3.1.0';
const CACHE = `viaje-nx500-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/viaje.json',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // El plan (JSON) va siempre por red primero: asi cualquier cambio subido al
  // repositorio se ve al abrir la app. Sin cobertura se sirve la ultima copia.
  if (url.pathname.endsWith('/data/viaje.json')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(req, { cache: 'no-store', signal: ctrl.signal });
          clearTimeout(timer);
          if (res && res.ok) { cache.put(req, res.clone()); return res; }
          throw new Error('bad response');
        } catch (e) {
          const cached = await cache.match(req, { ignoreSearch: true });
          if (!cached) throw e;
          const headers = new Headers(cached.headers);
          headers.set('X-Viaje-Cache', 'offline');
          return new Response(await cached.blob(), { status: 200, headers });
        }
      })
    );
    return;
  }

  // Resto de la app: responde desde caché al instante y refresca en segundo plano.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) return cached;
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('./index.html');
      return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
