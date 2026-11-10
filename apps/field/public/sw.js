/*
 * Offline app shell for the browser build (not used inside the native app).
 *
 * - Same-origin GET only. Cross-origin requests (the sync server, the
 *   one-time model download) and every non-GET pass straight through and
 *   are never cached, so no chart data ends up in this cache.
 * - Navigations: network first, falling back to the cached index.html.
 * - Everything else same-origin (hashed assets, ./ort/, ./models/): cache
 *   first, stored on first fetch.
 */
const VERSION = "pinpoint-shell-v1";
const SHELL = ["./", "./index.html"];

/** index.html plus the scripts and styles it links (the first page load happens before this worker runs). */
async function precacheShell() {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL);
  const html = await (await cache.match("./index.html")).text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (assets.length) await cache.addAll(assets);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pinpoint-shell-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(async () => (await caches.match("./index.html", { ignoreVary: true })) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // Only keep real files: not errors, and not an HTML fallback for a missing file.
          const type = res.headers.get("content-type") || "";
          const isPage = type.includes("text/html");
          if (res.ok && res.type === "basic" && !isPage) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
