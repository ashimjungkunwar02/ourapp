import { useState, useEffect, useCallback, useRef } from 'react'
import { pushAPI } from '../services/api'
import { isNativePlatform } from '../services/supabase'
import {
  swSupported,
  registerServiceWorker,
  getSWRegistration
} from '../utils/swRegister'

/**
 * Push notifications, split by platform.
 *
 * ── ANDROID / iOS (Capacitor build) ─────────────────────────────────────
 * Uses the native plugin -> FCM. Flow:
 *   requestPermissions() -> register() -> 'registration' listener gives the
 *   FCM token -> pushAPI.subscribe(token) stores it on the profile.
 * An Edge Function (supabase/functions/send-push) fans out via the FCM v1 API.
 *
 * ── BROWSER (Cloudflare Pages) ──────────────────────────────────────────
 * There is no VAPID endpoint any more — Supabase does not proxy web-push —
 * so `serverReady` stays false and PushPermissionBanner renders nothing
 * instead of offering permission for a subscription that could never be
 * delivered. The local coin-ready reminder still works via the service
 * worker when the tab is open.
 */
export function usePushNotifications() {
  const native = isNativePlatform()

  const [permission,  setPermission]  = useState(() => {
    if (native) return 'default'
    return swSupported() && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  })
  const [subscribed,  setSubscribed]  = useState(false)
  const [serverReady, setServerReady] = useState(native) // native push is always available
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState(null)
  // FCM token, kept so re-registration can be skipped. A real useRef — a plain
  // { current } object literal is re-created on every render, so the token would
  // be lost and React's compiler rules flag it as an illegal post-render write.
  const tokenRef = useRef(null)

  const isWebSupported = () =>
    swSupported() && 'PushManager' in window && 'Notification' in window

  const ensureRegistration = useCallback(async () => {
    if (!isWebSupported()) return null
    const existing = await getSWRegistration()
    return existing || registerServiceWorker()
  }, [])

  const syncSubscriptionState = useCallback(async () => {
    if (!isWebSupported()) return
    try {
      const reg = await getSWRegistration()
      const sub = await reg?.pushManager?.getSubscription()
      setSubscribed(Boolean(sub))
    } catch {
      setSubscribed(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (native) {
      // Ask the backend whether push is provisioned; if the call fails (e.g. not
      // signed in yet) assume native push is available and let subscribe()
      // surface the real error.
      pushAPI.status()
        .then(res => { if (!cancelled) setServerReady(Boolean(res.data?.enabled)) })
        .catch(()  => { if (!cancelled) setServerReady(true) })
      return () => { cancelled = true }
    }

    if (!isWebSupported()) return () => { cancelled = true }

    ;(async () => {
      try {
        await ensureRegistration()
        if (cancelled) return
        await syncSubscriptionState()

        // On web the backend reports enabled:false, so the banner stays hidden
        // rather than leading the user into a dead end.
        const res = await pushAPI.status()
        if (!cancelled) setServerReady(Boolean(res.data?.enabled))
      } catch {
        if (!cancelled) setServerReady(false)
      }
    })()

    return () => { cancelled = true }
  }, [native, ensureRegistration, syncSubscriptionState])

  // ── Native (FCM) path ───────────────────────────────────────────────────
  const subscribeNative = useCallback(async () => {
    // Dynamic import keeps Capacitor's native bridge out of the web chunk.
    const { PushNotifications } = await import('@capacitor/push-notifications')

    const perm = await PushNotifications.checkPermissions()
    let state  = perm.receive

    if (state === 'prompt' || state === 'prompt-with-rationale') {
      const req = await PushNotifications.requestPermissions()
      state = req.receive
    }
    setPermission(state)

    if (state !== 'granted') {
      setError(state === 'denied'
        ? 'Notifications are disabled in your device settings'
        : 'Permission not granted')
      return false
    }

    const token = await new Promise((resolve, reject) => {
      const onReg  = (t) => { cleanup(); resolve(t.value) }
      const onErr  = (e) => { cleanup(); reject(new Error(e?.error || 'FCM registration failed')) }
      const listeners = []
      const cleanup = () => { listeners.forEach(l => l.remove()) }

      listeners.push(PushNotifications.addListener('registration', onReg))
      listeners.push(PushNotifications.addListener('registrationError', onErr))

      // register() is fire-and-forget; the token arrives via the listener.
      // Guard against a device that never answers (no google-services.json,
      // offline, etc.) so the button cannot spin forever.
      setTimeout(() => {
        cleanup()
        reject(new Error('Timed out registering with Firebase. Check google-services.json.'))
      }, 20000)

      PushNotifications.register().catch(onErr)
    })

    if (!token) throw new Error('No push token returned')
    tokenRef.current = token

    // Show foreground notifications — Android suppresses them by default when
    // the app is focused, which would silently drop rain/bonus alerts.
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.info('[push] foreground notification:', n.title, n.body)
    })

    await pushAPI.subscribe(token)
    setSubscribed(true)
    return true
  }, [tokenRef])

  // ── Web path (kept for parity; disabled without a VAPID endpoint) ──────
  const subscribeWeb = useCallback(async () => {
    if (!isWebSupported()) {
      setError('Push notifications are not supported in this browser')
      return false
    }

    let result = Notification.permission
    if (result === 'default') {
      // Must come from a user gesture; the banner button provides one.
      result = await Notification.requestPermission()
    }
    setPermission(result)

    if (result !== 'granted') {
      setError(result === 'denied'
        ? 'Notifications are blocked in your browser settings'
        : 'Permission not granted')
      return false
    }

    // Supabase does not proxy web-push, so there is no key to subscribe with.
    // Report that honestly instead of calling PushManager with a bogus key.
    setError('Browser push is not available in this deployment; install the app for notifications')
    return false
  }, [])

  /** Full opt-in. Returns true only when the token reached the database. */
  const subscribe = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      return native ? await subscribeNative() : await subscribeWeb()
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Subscription failed'
      setError(message)
      console.error('[push] subscribe failed:', message)
      return false
    } finally {
      setBusy(false)
    }
  }, [native, subscribeNative, subscribeWeb])

  const unsubscribe = useCallback(async () => {
    setBusy(true)
    try {
      if (native) {
        // Capacitor has no unregister(); drop the stored token server-side so
        // it stops receiving fan-out. The OS permission stays as the user set it.
        tokenRef.current = null
      } else {
        const reg = await getSWRegistration()
        const sub = await reg?.pushManager?.getSubscription()
        if (sub) await sub.unsubscribe()
      }

      await pushAPI.unsubscribe().catch(() => {})
      setSubscribed(false)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }, [native, tokenRef])

  /** Back-compat shim for callers that only wanted the permission prompt. */
  const requestPermission = useCallback(() => subscribe(), [subscribe])

  /**
   * Local "your coin is ready" reminder.
   * Native: schedules a real local notification (works with the app closed).
   * Web: shows a service-worker notification while the tab is open.
   */
  const scheduleCoinNotification = useCallback(async (secondsLeft) => {
    const delay = Math.max(0, Number(secondsLeft) || 0) * 1000

    if (native) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        await LocalNotifications.schedule({
          notifications: [{
            id:   1001,
            title: 'LISA SWEEPS 🪙',
            body:  'Your free hourly coin is ready to claim!',
            // Android requires an absolute timestamp, not a relative delay.
            schedule: { at: new Date(Date.now() + delay), allowWhileIdle: true },
            sound:  'default',
            extra:  { route: '/game' }
          }]
        })
      } catch {
        // Permission not granted / plugin unavailable — non-fatal.
      }
      return
    }

    if (!isWebSupported()) return
    navigator.serviceWorker.ready.then(reg => {
      setTimeout(() => {
        reg.showNotification('LISA SWEEPS 🪙', {
          body:    'Your free hourly coin is ready to claim!',
          icon:    '/icons/icon-192.png',
          badge:   '/icons/icon-192.png',
          vibrate: [100, 50, 100],
          tag:     'coin-ready'
        })
      }, delay)
    }).catch(() => {})
  }, [native])

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
