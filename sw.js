// Bump this version whenever you change index.html so phones pick up the update.
const CACHE = "simple-recorder-v12";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg?v=4", "icon-192.png?v=4", "icon-512.png?v=4", "icon-maskable-512.png?v=4", "fonts/Inter-Regular.woff", "fonts/Inter-SemiBold.woff", "fonts/InterDisplay-Bold.woff", "fonts/JetBrainsMono-400.woff2"];

self.addEventListener("install", e => {
  // Cache files one by one so a single missing file can't stop the app installing.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
    );
    return;
  }
  if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
      }))
    );
  }
});
