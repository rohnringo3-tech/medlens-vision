// MedLens Vision service worker — network-first with timeout for the shell (updates win,
// stalled wifi falls back to cache fast), cache-first for immutable Google Fonts.
// opencv.js (16 MB wasm) is cached at install so the vision layer works offline;
// allSettled means a slow first install still succeeds without it.
const CACHE = "medlens-vision-v5";
/* opencv.js is NOT in SHELL: the idle warm-up fetches it through the SW route
   below, which caches it on first success — one download total instead of the
   install and the worker racing two parallel 11MB downloads on 3G. */
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./vision-worker.js",
  "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./apple-touch-icon.png"];
const FONT_HOSTS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkWithTimeout(req, ms) {
  return Promise.race([
    fetch(req),
    new Promise((_, rej) => setTimeout(() => rej(new Error("sw-timeout")), ms))
  ]);
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Google Fonts: immutable — cache-first so the brand typography survives offline
  if (FONT_HOSTS.includes(url.origin)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
        /* opaque responses (no-cors) are fine to cache for the immutable font hosts */
        if (resp.ok || resp.type === "opaque") {
          const copy = resp.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
        }
        return resp;
      }).catch(() => Response.error()))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // opencv.js (11 MB, immutable): cache-first, and write back on a miss so a
  // flaky first download self-heals — otherwise offline vision dies silently
  // for the life of this cache version.
  if (url.pathname.endsWith("/opencv.js")) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
        }
        return resp;
      }))
    );
    return;
  }

  // Same-origin shell: network first (3s), fall back to cache, then to index.html for navigations.
  // A COMPLETED but broken response (5xx mid-redeploy, captive portal) also
  // falls back to the cached copy instead of showing an error page.
  e.respondWith(
    networkWithTimeout(e.request, 3000)
      .then(resp => {
        if (resp.ok) {
          const copy = resp.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
          return resp;
        }
        return caches.match(e.request, { ignoreSearch: true }).then(hit => hit || resp);
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then(hit =>
          hit || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())
        )
      )
  );
});
