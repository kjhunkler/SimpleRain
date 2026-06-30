/* ============ Simple Games — service worker ============ */
const CACHE_NAME = "simple-games-v52";

const ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/app.css",
    "./js/storage.js",
    "./js/sound.js",
    "./js/app.js",
    "./js/games/snake.js",
    "./js/games/astro.js",
    "./js/games/piestack.js",
    "./js/games/flappy.js",
    "./js/games/moles.js",
    "./js/games/memory.js",
    "./js/games/echo.js",
    "./js/games/bricks.js",
    "./js/games/hopper.js",
    "./js/games/fruit.js",
    "./js/games/tiles.js",
    "./js/games/colorrush.js",
    "./js/games/beatloop.js",
    "./js/games/taptiles.js",
    "./js/games/stopspin.js",
    "./js/games/lanedash.js",
    "./js/games/stormquest.js",
    "./js/games/sentry.js",
    "./js/games/bughunt.js",
    "./js/games/digger.js",
    "./js/games/catcher.js",
    "./js/games/turtlecave.js",
    "./js/games/abctrace.js",
    "./js/games/lettersiege.js",
    "./js/games/watchswap.js",
    "./icons/icon.svg",
    "./icons/icon-maskable.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // cache: "reload" bypasses the HTTP cache so a new version always
            // precaches fresh files, not stale copies cached earlier in the session.
            .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
    );
});

// The page tells us when the user has agreed to switch to the new version.
self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Cache-first with network fallback; successful network responses refresh the cache.
self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request)
                .then((response) => {
                    if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
