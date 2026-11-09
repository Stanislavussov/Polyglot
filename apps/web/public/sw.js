// Push-only service worker: no fetch handler, so it never serves stale pages.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  // Always show something: Safari revokes push permission from a worker that
  // receives a push without displaying a notification.
  event.waitUntil(
    self.registration.showNotification(message.title || "Polyglot", {
      body: message.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: message.tag || "polyglot",
      data: { url: message.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const parsed = new URL(event.notification.data?.url || "/", self.location.origin);
  // Only our own pages: a notification must never open another site.
  const target = parsed.origin === self.location.origin ? parsed.href : self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      if (open) {
        await open.focus();
        if (open.url !== target && "navigate" in open) await open.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
