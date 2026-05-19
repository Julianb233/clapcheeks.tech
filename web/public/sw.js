// Clapcheeks service worker kill switch.
//
// Older production builds registered a worker that could keep serving stale
// App Router shells after deploys. Keeping this file available lets browsers
// update the old registration and retire it cleanly.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      await Promise.all(clients.map((client) => client.navigate(client.url)))
    })(),
  )
})
