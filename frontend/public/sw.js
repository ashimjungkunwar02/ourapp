/* global clients */
/* Lisa Sweeps service worker
 *
 * Cache-versioned: bump this string whenever CACHE_ASSETS or the caching
 * strategy changes, otherwise clients keep serving the old precache (this
 * matters now that the PWA icons were renamed to icon-192/512.png).
 */
const CACHE_NAME  = 'lisa-sweeps-v2'
const OFFLINE_URL = '/offline.html'

const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

// ── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll rejects the whole batch if any single asset 404s, which would
      // leave the SW uninstalled. Add individually and tolerate failures so one
      // missing optional file can't break offline support entirely.
      .then(cache => Promise.allSettled(
        CACHE_ASSETS.map(url => cache.add(url))
      ))
      .then(results => {
        const failed = CACHE_ASSETS.filter((_, i) => results[i].status === 'rejected')
        if (failed.length) console.warn('[sw] precache failed for:', failed)
      })
      .catch(err => console.log('[sw] cache install error:', err))
  )
  self.skipWaiting()
})

// ── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Should this request be handled by the cache at all? ─────────────────────
const isApiRequest = (url) =>
  url.pathname.startsWith('/api/') || url.pathname === '/api'

const isCacheable = (request, url) => {
  // Never intercept anything but GET. The previous version called
  // event.respondWith() for POST/PUT too, which broke API writes and tried to
  // cache their responses.
  if (request.method !== 'GET') return false

  // BUG FIX: skip API responses entirely. Caching /api/ meant a logged-out or
  // stale JSON payload (balances, notifications, metrics) could be replayed
  // from cache indefinitely, and 401s got cached as if they were content.
  if (isApiRequest(url)) return false

  // Socket.io polling transport — must never be cached or short-circuited.
  if (url.pathname.startsWith('/socket.io')) return false

  // Only cache same-origin static assets.
  if (url.origin !== self.location.origin) return false

  return true
}

// ── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  if (!isCacheable(event.request, url)) return // let the network handle it

  // Navigations: network first, fall back to the offline page.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Keep the app shell fresh so deploys aren't hidden behind a cache.
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put('/index.html', clone))
          }
          return res
        })
        .catch(() =>
          caches.match(event.request).then(hit => hit || caches.match(OFFLINE_URL))
        )
    )
    return
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(res => {
          // Only cache successful, basic responses. Caching an opaque or error
          // response would poison the cache.
          if (res.ok && res.type === 'basic') {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
          }
          return res
        })
        .catch(() => cached)

      return cached || network
    })
  )
})

// ── Push notification ───────────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Non-JSON payload: fall back to the raw text as the body.
    data = { body: event.data ? event.data.text() : '' }
  }
  if (!data || typeof data !== 'object') data = {}

  const options = {
    body:    data.body || 'Something exciting is happening!',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data:    { url: data.url || '/' },
    tag:     data.tag || 'lisa-sweeps',
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'LISA SWEEPS \uD83C\uDFB0', options)
  )
})

// ── Notification click ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          // Reuse an existing tab and navigate it, instead of only focusing
          // whatever page it happened to be on.
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(target)
            return client.focus()
          }
        }
        return clients.openWindow(target)
      })
  )
})
