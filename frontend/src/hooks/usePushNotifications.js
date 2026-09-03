import { useState, useEffect, useCallback } from 'react'
import { pushAPI } from '../services/api'
import {
  swSupported,
  registerServiceWorker,
  getSWRegistration
} from '../utils/swRegister'

/** Convert a base64url VAPID key into the Uint8Array PushManager expects. */
const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData = atob(base64)
  const output  = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i)
  return output
}

const isSupported = () =>
  swSupported() &&
  'PushManager' in window &&
  'Notification' in window

/**
 * Web push subscription lifecycle.
 *
 * Previously this hook asked for permission and then STOPPED: it never called
 * PushManager.subscribe() and never sent anything to the backend, so
 * sendPushToAll() always found zero subscriptions. The service worker was also
 * never registered anywhere, meaning `navigator.serviceWorker.ready` would have
 * hung forever had it been called.
 */
export function usePushNotifications() {
  const [permission,  setPermission]  = useState(
    isSupported() ? Notification.permission : 'unsupported'
  )
  const [subscribed,  setSubscribed]  = useState(false)
  const [serverReady, setServerReady] = useState(false)
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState(null)

  const ensureRegistration = useCallback(async () => {
    if (!isSupported()) return null
    const existing = await getSWRegistration()
    // registerServiceWorker() is gated (prod only, or VITE_ENABLE_SW=true) and
    // returns null when disabled, rather than throwing.
    return existing || registerServiceWorker()
  }, [])

  const syncSubscriptionState = useCallback(async () => {
    if (!isSupported()) return
    try {
      const reg = await getSWRegistration()
      const sub = await reg?.pushManager?.getSubscription()
      setSubscribed(Boolean(sub))
    } catch {
      setSubscribed(false)
    }
  }, [])

  // On mount: register the SW, then report whether push is usable at all.
  useEffect(() => {
    // `permission` is already initialised to 'unsupported' when the APIs are
    // absent, so there is nothing to set here — just bail out.
    if (!isSupported()) return

    let cancelled = false

    ;(async () => {
      try {
        await ensureRegistration()
        if (cancelled) return
        await syncSubscriptionState()

        // The backend may have no VAPID keys configured; asking the user for
        // permission in that case would be a dead end.
        const res = await pushAPI.status()
        if (!cancelled) setServerReady(Boolean(res.data?.enabled))
      } catch {
        // Not authenticated yet, or push disabled server-side. Either way the
        // banner stays hidden rather than offering something that can't work.
        if (!cancelled) setServerReady(false)
      }
    })()

    return () => { cancelled = true }
  }, [ensureRegistration, syncSubscriptionState])

  /** Resolve the VAPID public key: env first, then ask the backend. */
  const getPublicKey = useCallback(async () => {
    const fromEnv = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()
    // The committed .env contained the literal placeholder
    // "BYourPublicKeyFromStep4Here" — reject that instead of feeding it to
    // PushManager, which would throw an opaque encoding error.
    if (fromEnv && !/yourpublickey|placeholder|^B?your/i.test(fromEnv)) {
      return fromEnv
    }

    try {
      const res = await pushAPI.vapidKey()
      return res.data?.publicKey || null
    } catch {
      return null
    }
  }, [])

  /**
   * Full opt-in: permission -> PushManager.subscribe -> POST to the backend.
   * @returns true only when the server has stored a working subscription.
   */
  const subscribe = useCallback(async () => {
    setError(null)

    if (!isSupported()) {
      setError('Push notifications are not supported in this browser')
      return false
    }

    setBusy(true)
    try {
      let result = Notification.permission
      if (result === 'default') {
        // Must be called from a user gesture; the banner button provides one.
        result = await Notification.requestPermission()
      }
      setPermission(result)

      if (result !== 'granted') {
        setError(result === 'denied'
          ? 'Notifications are blocked in your browser settings'
          : 'Permission not granted')
        return false
      }

      const publicKey = await getPublicKey()
      if (!publicKey) {
        setError('Push is not configured on this server')
        return false
      }

      const reg = await ensureRegistration()
      if (!reg) {
        setError('Service worker is not available in this build')
        return false
      }

      // Reuse an existing subscription if the browser already has one.
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        })
      }

      // THE MISSING STEP: hand the subscription to the API so it is persisted
      // on the user document and sendPushToAll() can find it.
      await pushAPI.subscribe(sub.toJSON())

      setSubscribed(true)
      return true
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Subscription failed'
      setError(message)
      console.error('[push] subscribe failed:', message)
      return false
    } finally {
      setBusy(false)
    }
  }, [ensureRegistration, getPublicKey])

  const unsubscribe = useCallback(async () => {
    setBusy(true)
    try {
      const reg = await getSWRegistration()
      const sub = await reg?.pushManager?.getSubscription()
      if (sub) await sub.unsubscribe()

      await pushAPI.unsubscribe().catch(() => {})
      setSubscribed(false)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  /** Back-compat shim for callers that only wanted the permission prompt. */
  const requestPermission = useCallback(async () => {
    if (!isSupported()) return false
    return subscribe()
  }, [subscribe])

  const scheduleCoinNotification = useCallback((secondsLeft) => {
    if (!isSupported()) return
    navigator.serviceWorker.ready.then(reg => {
      setTimeout(() => {
        reg.showNotification('LISA SWEEPS 🪙', {
          body:    'Your free hourly coin is ready to claim!',
          icon:    '/icons/icon-192.png',
          badge:   '/icons/icon-192.png',
          vibrate: [100, 50, 100],
          tag:     'coin-ready'
        })
      }, secondsLeft * 1000)
    }).catch(() => {})
  }, [])

  return {
    permission,
    subscribed,
    serverReady,
    busy,
    error,
    subscribe,
    unsubscribe,
    requestPermission,
    scheduleCoinNotification
  }
}
