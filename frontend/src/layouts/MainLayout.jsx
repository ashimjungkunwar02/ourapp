import { useState, useEffect }        from 'react'
import { Outlet, useNavigate,
         useLocation }                from 'react-router-dom'
import { Home, Users, Phone, LogOut } from 'lucide-react'
import { motion }                     from 'framer-motion'
import { useAuth }                    from '../context/AuthContext'
import Notifications                  from '../components/Notifications'
import RainEffect                     from '../components/RainEffect'
import PushPermissionBanner           from '../components/PushPermissionBanner'
import { useSocket }                  from '../hooks/useSocket'
import { useReferral }                 from '../hooks/useReferral'
import { haptics }                    from '../utils/haptics'
import { soundEngine }                from '../utils/soundEngine'

const NAV_ITEMS = [
  { path: '/',         label: 'Home',    icon: Home  },
  { path: '/referral', label: 'Refer',   icon: Users },
  { path: '/contact',  label: 'Support', icon: Phone },
]

export default function MainLayout() {
  const { logout }              = useAuth()
  const navigate                = useNavigate()
  const location                = useLocation()
  const [rainActive,  setRainActive]  = useState(false)
  const [rainAmount,  setRainAmount]  = useState(0)
  const [bonus,       setBonus]       = useState(null)
  const [isOnline,    setIsOnline]    = useState(navigator.onLine)

  // Referral: consumes a ?ref= code captured at load / after login.
  const { result: referralResult, dismiss: dismissReferral } = useReferral()

  // Auto-dismiss the referral toast.
  useEffect(() => {
    if (!referralResult) return
    const t = setTimeout(dismissReferral, 6000)
    return () => clearTimeout(t)
  }, [referralResult, dismissReferral])

  // Socket for real-time events
  useSocket({
    onRain: (data) => {
      setRainAmount(data.amount)
      setRainActive(true)
      soundEngine.rainSound()
      haptics.rain()
    },
    // Bonus launches were broadcast by the server but nothing listened, so
    // admins saw "notified N users" while players saw nothing until a reload.
    onBonus: (data) => {
      setBonus(data)
      soundEngine.rainSound?.()
      haptics.medium?.()
    }
  })

  // Online / offline detection
  useEffect(() => {
    const goOnline  = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const handleNav = (path) => {
    haptics.light()
    navigate(path)
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">

      {/* 🌧️ Rain Effect */}
      <RainEffect
        active={rainActive}
        amount={rainAmount}
        onComplete={() => setRainActive(false)}
      />

      {/* 📡 Offline Banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-red-500
                        text-white text-center py-2 text-sm font-bold">
          📡 Reconnecting to Lisa Sweeps...
        </div>
      )}

      {/* 🔔 Push Permission Banner */}
      <PushPermissionBanner />

      {/* 🎁 Live bonus broadcast */}
      {bonus && (
        <div className="fixed top-16 left-4 right-4 z-[150] max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#111] border border-purple-500/40 rounded-2xl p-4
                       shadow-2xl flex items-start gap-3"
          >
            <span className="text-2xl" aria-hidden="true">🎁</span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">
                {bonus.percentage}% {bonus.type === 'deposit' ? 'Deposit' : 'Referral'} Bonus Live!
              </p>
              <p className="text-gray-400 text-xs break-words">
                {bonus.message || `Valid for ${bonus.validHours} hours only!`}
              </p>
            </div>
            <button
              onClick={() => setBonus(null)}
              aria-label="Dismiss"
              className="text-gray-500 hover:text-white transition-colors shrink-0"
            >
              ✕
            </button>
          </motion.div>
        </div>
      )}

      {/* 👥 Referral code applied */}
      {referralResult && (
        <div className="fixed bottom-24 left-4 right-4 z-[150] max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className={`rounded-2xl p-4 shadow-2xl flex items-center gap-3
                        ${referralResult.ok
                          ? 'bg-[#111] border border-green-500/40'
                          : 'bg-[#111] border border-red-500/40'}`}
          >
            <span className="text-2xl" aria-hidden="true">
              {referralResult.ok ? '🎉' : '⚠️'}
            </span>
            <p className={`flex-1 text-sm font-medium
                           ${referralResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {referralResult.ok
                ? `Referral applied — you earned ${referralResult.coins} coins!`
                : referralResult.message}
            </p>
            <button
              onClick={dismissReferral}
              aria-label="Dismiss"
              className="text-gray-500 hover:text-white transition-colors shrink-0"
            >
              ✕
            </button>
          </motion.div>
        </div>
      )}

      {/* ── Top Navigation Bar ───────────────────────────────────── */}
      <header className="bg-[#111] border-b border-gray-800 px-4 py-3
                         flex items-center justify-between sticky top-0 z-40">
        {/* Logo */}
        <button
          onClick={() => handleNav('/')}
          className="flex items-center gap-1.5 active:opacity-70 transition-opacity"
        >
          <span className="text-white font-black text-xl">LISA</span>
          <span className="text-green-400 font-black text-xl">SWEEPS</span>
        </button>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <Notifications />
          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-white transition-colors p-1.5
                       hover:bg-white/5 rounded-lg"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ── Page Content ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pb-24">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          <Outlet />
        </motion.div>
      </main>

      {/* ── Bottom Navigation Bar ────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-[#111]
                   border-t border-gray-800 flex items-center
                   justify-around px-4 py-3 z-40"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname === path
          return (
            <button
              key={path}
              onClick={() => handleNav(path)}
              className={`flex flex-col items-center gap-1 px-6 py-1
                          rounded-xl transition-all duration-200
                          ${isActive
                            ? 'text-green-400'
                            : 'text-gray-500 hover:text-gray-300'}`}
            >
              <Icon size={22} />
              <span className="text-xs font-medium">{label}</span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute bottom-1 w-1 h-1 bg-green-400 rounded-full"
                />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}