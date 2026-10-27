/* Keeps the Recto desk and this edition on the device after one visit. */
const CACHE = "recto-desk-v12";
const READING = "recto-reading";
const READERS = "recto-readers";

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
          new URL("vendor/djvu.js", scope).href,
          new URL("vendor/ppocr/det.tar", scope).href,
          new URL("vendor/ppocr/rec.tar", scope).href,
          new URL("vendor/ppocr/devanagari.tar", scope).href,
          new URL("vendor/ppocr/arabic.tar", scope).href,
          new URL("vendor/ppocr/cyrillic.tar", scope).href,
          new URL("vendor/ppocr/el.tar", scope).href,
          new URL("vendor/ppocr/korean.tar", scope).href,
          new URL("vendor/ppocr/th.tar", scope).href,
          new URL("vendor/ppocr/ta.tar", scope).href,
          new URL("vendor/ppocr/te.tar", scope).href,
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== READING && key !== READERS).map((key) => caches.delete(key))))
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
  if (url.searchParams.has("store")) return;
  if (/\/vendor\/ppocr\/(?!det\.tar$|rec\.tar$).+\.tar$/.test(url.pathname)) {
    event.respondWith(
      caches.open(READERS).then((extra) =>
        extra.match(req).then((hit) => hit || caches.open(CACHE).then((desk) => desk.match(req).then((kept) => kept || fetch(req)))),
      ),
    );
    return;
  }

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
