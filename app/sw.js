const CACHE_NAME = "pitopi-v6";
const urlsToCache = [
  "/",
  "/index.html",
  "/login.html",
  "/manifest.json",
  "/assets/style/tailwind.css",
  "/assets/style/style.css",
  "/assets/style/login.css",
  "/assets/img/boringavatar.svg",
  "/assets/script/i18n.js",
  "/assets/script/login.js",
  "/assets/script/theme.js",
  "/assets/config/translations.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch(() => {
        console.log("Some cache files may not be available offline");
      });
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GETs. Auth endpoints and the Socket.IO transport
  // must never be cached or replayed from the cache.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/socket.io/") ||
    url.pathname === "/login" ||
    url.pathname === "/signup" ||
    url.pathname === "/logout"
  ) {
    return;
  }

  {
    if (
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".html") ||
      url.pathname === "/"
    ) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (
              response &&
              response.status === 200 &&
              response.type !== "error"
            ) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return response;
          })
          .catch(() =>
            caches
              .match(event.request)
              .then((response) => response || caches.match("/index.html")),
          ),
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) return response;
        return fetch(event.request)
          .then((response) => {
            if (
              !response ||
              response.status !== 200 ||
              response.type === "error"
            ) {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return response;
          })
          .catch(() => {
            return caches.match("/index.html");
          });
      }),
    );
  }
});
