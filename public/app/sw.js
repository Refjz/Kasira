// Offline shell: network first for app files (so updates arrive right away), cache as fallback. API calls are never cached.
const CACHE = "kasira-shell-v5";
const SHELL = ["./", "index.html", "app.js", "core.js", "pricing.js", "biz.js", "pos.js", "manage.js", "reports.js", "print.js", "scan.js", "manifest.webmanifest", "icon-512.png", "logo.svg", "favicon-64.png", "../theme.js", "vendor/qrcode.js", "vendor/zxing.min.js", "vendor/xlsx.mini.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  const cacheable = u.origin === location.origin || u.hostname.endsWith("fonts.googleapis.com") || u.hostname.endsWith("fonts.gstatic.com");
  if (!cacheable) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
