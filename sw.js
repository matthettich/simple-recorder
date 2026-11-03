// Bump this version whenever you change index.html so phones pick up the update.
const CACHE = "simple-recorder-v13";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg?v=4", "icon-192.png?v=4", "icon-512.png?v=4", "icon-maskable-512.png?v=4", "fonts/Inter-Regular.woff", "fonts/Inter-SemiBold.woff", "fonts/InterDisplay-Bold.woff", "fonts/JetBrainsMono-400.woff2"];
// On a slow or dead connection, wait this long for the network before opening the copy kept on the phone
const NET_WAIT = 3000;

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

// The page itself: the newest from the network, but if the network is slow, the copy kept on the phone after NET_WAIT.
// Everything else (fonts, icons): the kept copy straight away. Either way the fresh copy lands in the cache for next time.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;
  const nav = e.request.mode === "navigate";
  const net = fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(e.request, copy)).then(() => res, () => res); }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith((async () => {
    const kept = await caches.match(e.request) || (nav ? await caches.match("index.html") : null);
    if (!kept) return net;
    if (!nav) return kept;
    return Promise.race([net.catch(() => kept), new Promise(r => setTimeout(() => r(kept), NET_WAIT))]);
  })());
});
