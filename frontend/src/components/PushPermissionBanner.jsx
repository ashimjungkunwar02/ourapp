import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, X } from 'lucide-react'
import { usePushNotifications } from '../hooks/usePushNotifications'

const DISMISS_KEY = 'push_dismissed'

export default function PushPermissionBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true'
  )

  // The banner used to call Notification.requestPermission() directly and then
  // throw the result away — no PushManager.subscribe(), no POST to the backend,
  // so the server never learned about the device. The hook does the whole chain.
  const {
    permission,
    subscribed,
    serverReady,
    busy,
    error,
    subscribe
  } = usePushNotifications()

  const handleAllow = async () => {
    const ok = await subscribe()
    // Only hide the banner once the subscription is actually persisted.
    if (ok) setDismissed(true)
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  const granted = permission === 'granted'

  // Nothing to offer if the browser lacks support, the user already opted in, or
  // the backend has no VAPID keys (asking would be a dead end).
  if (dismissed || subscribed || granted || permission === 'unsupported') return null
  if (!serverReady) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -60 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -60 }}
        className="fixed top-16 left-4 right-4 z-50 max-w-md mx-auto"
      >
        <div className="bg-[#111] border border-green-500/30 rounded-2xl
                        p-4 shadow-2xl shadow-green-500/10 flex
                        items-center gap-3">
          <div className="p-2 bg-green-500/20 rounded-xl shrink-0">
            <Bell size={20} className="text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm">
              Enable Notifications
            </p>
            <p className="text-gray-400 text-xs">
              Get alerted when your free coin is ready!
            </p>
            {error && (
              <p className="text-red-400 text-xs mt-1 break-words">{error}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleAllow}
              disabled={busy}
              className="bg-green-500 text-black font-bold text-xs
                         px-3 py-1.5 rounded-lg hover:bg-green-400
                         transition-colors disabled:opacity-60"
            >
              {busy ? '...' : 'Allow'}
            </button>
            <button
              onClick={handleDismiss}
              aria-label="Dismiss"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
