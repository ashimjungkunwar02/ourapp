import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, X } from 'lucide-react'
import { gameAPI } from '../services/api'

export default function Notifications() {
  const [notifs, setNotifs] = useState([])
  const [open,   setOpen]   = useState(false)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    fetchNotifs()
    const interval = setInterval(fetchNotifs, 60000)
    return () => clearInterval(interval)
  }, [])

  const fetchNotifs = async () => {
    try {
      const res = await gameAPI.getNotifications()
      setNotifs(res.data)
      setUnread(res.data.filter(n => !n.read).length)
    } catch {}
  }

  const markRead = async (id) => {
    try {
      await gameAPI.markNotificationRead(id)
      setNotifs(prev =>
        prev.map(n => n._id === id ? { ...n, read: true } : n)
      )
      setUnread(prev => Math.max(0, prev - 1))
    } catch {}
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-gray-400 hover:text-white
                   transition-colors"
      >
        <Bell size={22} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5
                           bg-green-500 text-black text-xs font-bold
                           rounded-full flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 top-12 w-80 bg-[#111]
                       border border-gray-700 rounded-2xl shadow-2xl
                       z-50 overflow-hidden"
          >
            <div className="p-4 border-b border-gray-700 flex items-center
                            justify-between">
              <h3 className="text-white font-bold">Notifications</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {notifs.length === 0 ? (
                <p className="text-gray-500 text-center py-8 text-sm">
                  No notifications yet
                </p>
              ) : (
                notifs.map(n => (
                  <div
                    key={n._id}
                    onClick={() => markRead(n._id)}
                    className={`p-4 border-b border-gray-800/50
                                cursor-pointer hover:bg-white/5
                                transition-colors
                                ${!n.read ? 'bg-green-500/5' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl">
                        {n.type === 'bonus'   ? '🎁' :
                         n.type === 'referral' ? '👥' : '📢'}
                      </span>
                      <div className="flex-1">
                        <p className="text-white text-sm font-medium">
                          {n.title}
                        </p>
                        <p className="text-gray-400 text-xs mt-0.5">
                          {n.message}
                        </p>
                        <p className="text-gray-600 text-xs mt-1">
                          {new Date(n.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      {!n.read && (
                        <div className="w-2 h-2 bg-green-400
                                        rounded-full ml-auto mt-1" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}