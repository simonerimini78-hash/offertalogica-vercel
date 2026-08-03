const CACHE = "offertalogica-app-v23";
const APP_SHELL = [
  "/app.html",
  "/app-bills.js",
  "/manifest.webmanifest",
  "/assets/logo-offertalogica-header.png",
  "/assets/logo-offertalogica-icon.png",
  "/assets/app-icon-180.png",
  "/assets/app-icon-192.png",
  "/assets/app-icon-512.png",
  "/assets/app-icon-1024.png",
  "/come-funziona.html",
  "/termini-condizioni.html",
  "/offerte-luce-gas-aggiornate.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // addAll fails the whole install if a single URL 404s; add one by one
      // so a missing/renamed page doesn't break the entire app shell cache.
      Promise.all(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => console.warn("Precache saltato:", url, err))
        )
      )
    )
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function cachePut(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch (err) {
    console.warn("Impossibile aggiornare la cache:", request.url, err);
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) cachePut(request, response.clone());
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("/app.html"))
    );
    return;
  }

  if (["style", "script", "image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          if (response.ok) cachePut(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
