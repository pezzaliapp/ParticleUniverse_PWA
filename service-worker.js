// Minimal offline cache for Particle Universe — PezzaliAPP Cosmos
const CACHE = 'particle-universe-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './readme.html'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(res=> res || fetch(e.request).then(r=>{
      const copy = r.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy));
      return r;
    }).catch(()=> caches.match('./')))
  );
});
