// ManaBin's service worker: lets the installed app open and scan offline.
// vite.config.ts stamps the build and text-reader folder into this file.
const BUILD = "__BUILD__";
const OCR = "__OCR__";
const APP = `manabin-app-${BUILD}`;
const READER = `manabin-${OCR.replace(/\//g, "-")}`;
const LIBRARY = "manabin-library";

self.addEventListener("install", (event) => {
  // Cache the page itself now; scripts and styles are cached as they load.
  event.waitUntil(caches.open(APP).then((c) => c.addAll(["./", "./manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("manabin-") && name !== APP && name !== READER && name !== LIBRARY) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** Fetches and keeps a copy; the copy is written before the worker may stop. */
const fromNetwork = async (event, cacheName, request) => {
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    event.waitUntil(caches.open(cacheName).then((c) => c.put(request, copy)));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;  // card images, sign-in and EDHREC go straight to the network
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  if (req.mode === "navigate") {
    // The page: fresh when online, the cached copy when not.
    event.respondWith(fromNetwork(event, APP, req).catch(() => caches.match("./", { cacheName: APP }).then((r) => r || caches.match(req))));
  } else if (path.startsWith("assets/") || path.startsWith("ocr/") || path === "manifest.webmanifest" || path.startsWith("icons/")) {
    // Files whose names change when their contents do: the cache is always right.
    const name = path.startsWith("ocr/") ? READER : APP;
    event.respondWith(caches.match(req, { cacheName: name }).then((hit) => hit || fromNetwork(event, name, req)));
  } else if (path.startsWith("library/")) {
    // Card data and prices: fresh when online (the browser revalidates cheaply), cached when not.
    event.respondWith(fromNetwork(event, LIBRARY, req).catch(() => caches.match(req, { cacheName: LIBRARY }).then((r) => r || Response.error())));
  }
});
