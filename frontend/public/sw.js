const CACHE_NAME  = 'lisa-sweeps-v1'
const OFFLINE_URL = '/offline.html'

const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_ASSETS))
      .catch(err => console.log('Cache install error:', err))
  )
  self.skipWaiting()
})

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// Fetch
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    )
    return
  }
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone()
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, clone))
        return res
      })
      .catch(() => caches.match(event.request))
  )
})

// Push notification
self.addEventListener('push', event => {
  const data    = event.data?.json() || {}
  const options = {
    body:    data.body  || 'Something exciting is happening!',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data:    { url: data.url || '/' },
    tag:     data.tag   || 'lisa-sweeps',
  }
  event.waitUntil(
    self.registration.showNotification(
      data.title || 'LISA SWEEPS 🎰',
      options
    )
  )
})

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus()
        }
        return clients.openWindow(
          event.notification.data?.url || '/'
        )
      })
  )
})