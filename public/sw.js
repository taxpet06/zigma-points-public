// public/sw.js — root-scope service worker (controls the whole origin, T-07-10).
// Source: Next.js official PWA guide (07-RESEARCH.md Pattern 3), copied verbatim.

// Take control immediately on update instead of waiting for every tab/PWA instance
// to close. Without this, a device that registered an older sw.js keeps running it
// (and its old/absent push handler) until fully closed — the #1 cause of "my push
// changes don't take effect" / "only works when open". Safe here: no caching, so a
// mid-session takeover can't serve stale assets.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  if (!event.data) return
  const data = event.data.json() // { title, body, url }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      data: { url: data.url },
    })
  )
})

// ponytail: no-op passthrough. Exists solely so Chrome treats the site as
// installable — the WebAPK criteria require a service worker with a fetch
// listener, else "Add to Home Screen" makes a plain shortcut (address bar)
// instead of a standalone app. No offline caching by design; add a cache
// strategy here only if offline support is ever needed.
self.addEventListener("fetch", () => {})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? "/"
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus()
      }
      return clients.openWindow(url)
    })
  )
})
