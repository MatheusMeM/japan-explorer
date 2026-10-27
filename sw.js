// Service worker: guarda o app inteiro na instalação e responde do cache (offline-first).
// VERSAO e ARQUIVOS são preenchidos pelo build.py. Os .pmtiles ficam fora: o app guarda no cache 'mapas'.
const VERSAO = "43c8484d2dca";
const ARQUIVOS = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-180.png", "icon-512.png", "exemplo-locais.csv", "data/dados.enc", "vendor/basemaps.js", "vendor/fonts/Noto Sans Italic/0-255.pbf", "vendor/fonts/Noto Sans Italic/12288-12543.pbf", "vendor/fonts/Noto Sans Italic/256-511.pbf", "vendor/fonts/Noto Sans Italic/512-767.pbf", "vendor/fonts/Noto Sans Italic/65024-65279.pbf", "vendor/fonts/Noto Sans Italic/65280-65535.pbf", "vendor/fonts/Noto Sans Italic/768-1023.pbf", "vendor/fonts/Noto Sans Italic/7680-7935.pbf", "vendor/fonts/Noto Sans Italic/8192-8447.pbf", "vendor/fonts/Noto Sans Italic/8448-8703.pbf", "vendor/fonts/Noto Sans Italic/8704-8959.pbf", "vendor/fonts/Noto Sans Italic/9472-9727.pbf", "vendor/fonts/Noto Sans Italic/9728-9983.pbf", "vendor/fonts/Noto Sans Medium/0-255.pbf", "vendor/fonts/Noto Sans Medium/12288-12543.pbf", "vendor/fonts/Noto Sans Medium/256-511.pbf", "vendor/fonts/Noto Sans Medium/512-767.pbf", "vendor/fonts/Noto Sans Medium/65024-65279.pbf", "vendor/fonts/Noto Sans Medium/65280-65535.pbf", "vendor/fonts/Noto Sans Medium/768-1023.pbf", "vendor/fonts/Noto Sans Medium/7680-7935.pbf", "vendor/fonts/Noto Sans Medium/8192-8447.pbf", "vendor/fonts/Noto Sans Medium/8448-8703.pbf", "vendor/fonts/Noto Sans Medium/8704-8959.pbf", "vendor/fonts/Noto Sans Medium/9472-9727.pbf", "vendor/fonts/Noto Sans Medium/9728-9983.pbf", "vendor/fonts/Noto Sans Regular/0-255.pbf", "vendor/fonts/Noto Sans Regular/12288-12543.pbf", "vendor/fonts/Noto Sans Regular/256-511.pbf", "vendor/fonts/Noto Sans Regular/512-767.pbf", "vendor/fonts/Noto Sans Regular/65024-65279.pbf", "vendor/fonts/Noto Sans Regular/65280-65535.pbf", "vendor/fonts/Noto Sans Regular/768-1023.pbf", "vendor/fonts/Noto Sans Regular/7680-7935.pbf", "vendor/fonts/Noto Sans Regular/8192-8447.pbf", "vendor/fonts/Noto Sans Regular/8448-8703.pbf", "vendor/fonts/Noto Sans Regular/8704-8959.pbf", "vendor/fonts/Noto Sans Regular/9472-9727.pbf", "vendor/fonts/Noto Sans Regular/9728-9983.pbf", "vendor/maplibre-gl.css", "vendor/maplibre-gl.js", "vendor/pmtiles.js", "vendor/sprites/light.json", "vendor/sprites/light.png", "vendor/sprites/light@2x.json", "vendor/sprites/light@2x.png"];
const CACHE = 'app-' + VERSAO;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('.pmtiles')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() =>
    e.request.mode === 'navigate' ? caches.match('./') : Response.error())));
});
