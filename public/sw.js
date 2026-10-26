/* Keeps the Recto desk and this edition on the device after one visit. */
const CACHE = "recto-desk-v8";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => {
        const scope = self.registration.scope;
        const urls = [
          scope,
          new URL("favicon.svg", scope).href,
          new URL("the-dhammapada.epub", scope).href,
          new URL("samples/varieties.epub", scope).href,
          new URL("samples/republic.epub", scope).href,
          new URL("samples/cannon.epub", scope).href,
          new URL("samples/ascent.epub", scope).href,
          new URL("vendor/djvu.js", scope).href,
          new URL("vendor/ppocr/det.tar", scope).href,
          new URL("vendor/ppocr/rec.tar", scope).href,
          new URL("vendor/ort/ort-wasm-simd-threaded.jsep.wasm", scope).href,
          new URL("vendor/ort/ort-wasm-simd-threaded.jsep.mjs", scope).href,
          new URL("vendor/pdfjs/wasm/openjpeg.wasm", scope).href,
          new URL("vendor/pdfjs/wasm/jbig2.wasm", scope).href,
        ];
        return Promise.all(urls.map((url) => cache.add(url).catch(() => {})));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/__grok/")) return;
  if (url.pathname.includes("/assets/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match(self.registration.scope) : undefined))),
  );
});
