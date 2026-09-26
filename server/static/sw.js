// Service worker AW Hub: network-first. Data (/api) dan halaman ber-login TIDAK di-cache,
// hanya ikon & halaman offline — supaya data pribadi tidak tersimpan di perangkat.
const CACHE = "awhub-v1";
const OFFLINE = "/offline.html";
const ASSETS = [OFFLINE, "/favicon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    // halaman: selalu dari jaringan; offline → halaman offline
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  } else if (url.pathname.startsWith("/icons/") || url.pathname === "/favicon.svg") {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
