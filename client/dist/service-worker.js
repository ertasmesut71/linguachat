/**
 * LinguaChat service worker (v1).
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS): cache-first with versioned cache; falls back
 *     to network on miss; updated on every deploy via CACHE_VERSION bump.
 *   - /api/* and /ws: NEVER cached (live data, auth, real-time).
 *   - Static images / fonts / icons: stale-while-revalidate.
 *
 * The service worker is only registered in production (see main.jsx).
 */

const CACHE_VERSION = "linguachat-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Minimal set of paths cached on install. The Vite-built JS/CSS get URLs
// with content hashes that we cannot know at SW-build time, so we also
// cache them lazily on first fetch.
const SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ─── Install: pre-cache the shell ───
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Use {cache: "reload"} so we don't accidentally re-cache a stale copy.
      cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: "reload" })))
    ).then(() => self.skipWaiting())
  );
});

// ─── Activate: drop any old version's caches ───
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch handler ───
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only intercept GET. POST / PUT / DELETE go straight to network.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // NEVER touch real-time / API traffic. WebSocket upgrade requests
  // are handled by browser internally but we explicitly skip /ws too.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/ws")) return;

  // Same-origin only (don't proxy fonts or third-party assets through SW)
  if (url.origin !== self.location.origin) return;

  // Static assets (Vite emits /assets/*-[hash].{js,css,png,...}): SWR
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // App shell + navigation: cache-first with network fallback
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirstFallbackToShell(req));
    return;
  }

  // Default: try cache, fall back to network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.status === 200 && res.type === "basic") {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => cached);
  return cached || networkPromise;
}

async function networkFirstFallbackToShell(req) {
  try {
    const fresh = await fetch(req);
    // Cache the latest navigation response under "/" so offline navigations
    // get a real shell back instead of a generic browser error.
    if (fresh && fresh.status === 200) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/", fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match("/") || await cache.match("/index.html");
    if (cached) return cached;
    return new Response("Offline — and no cached shell available.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// Allow the page to ask the SW to update itself (used by main.jsx)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ─── E2 — Web Push notification handler ───
// The server sends a JSON payload via web-push when a recipient has no
// open WebSocket connection. We parse it and display a native notification.
self.addEventListener("push", (event) => {
  let data = { title: "LinguaChat", body: "New message" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // If parsing fails, fall back to default title/body above.
  }

  const options = {
    body: data.body || "New message",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.chatId ? `chat-${data.chatId}` : "default",
    renotify: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title || "LinguaChat", options));
});

// ─── Notification click → focus or open the app at the right chat ───
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // If an existing LinguaChat tab/window is open, focus it.
        for (const client of windowClients) {
          if (new URL(client.url).pathname === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        // If any LinguaChat window exists, navigate it to the target URL.
        for (const client of windowClients) {
          if ("navigate" in client && "focus" in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }
        }
        // Otherwise open a new window.
        return clients.openWindow(targetUrl);
      })
  );
});
