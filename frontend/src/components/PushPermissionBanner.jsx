import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, X } from 'lucide-react'

export default function PushPermissionBanner() {
  const [dismissed, setDismissed] = useState(
    localStorage.getItem('push_dismissed') === 'true'
  )
  const [loading, setLoading] = useState(false)
  const [granted, setGranted] = useState(
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  )

  const handleAllow = async () => {
    setLoading(true)
    try {
      if (typeof Notification !== 'undefined') {
        const result = await Notification.requestPermission()
        if (result === 'granted') {
          setGranted(true)
        }
      }
    } catch {}
    setLoading(false)
    setDismissed(true)
  }

  const handleDismiss = () => {
    localStorage.setItem('push_dismissed', 'true')
    setDismissed(true)
  }

  if (dismissed || granted) return null

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
          <div className="p-2 bg-green-500/20 rounded-xl">
            <Bell size={20} className="text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">
              Enable Notifications
            </p>
            <p className="text-gray-400 text-xs">
              Get alerted when your free coin is ready!
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAllow}
              disabled={loading}
              className="bg-green-500 text-black font-bold text-xs
                         px-3 py-1.5 rounded-lg hover:bg-green-400
                         transition-colors"
            >
              {loading ? '...' : 'Allow'}
            </button>
            <button
              onClick={handleDismiss}
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