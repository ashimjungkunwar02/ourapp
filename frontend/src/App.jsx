import { useState, useEffect }     from 'react'
import { useAuth }                 from './context/AuthContext'
import SplashScreen                from './components/SplashScreen'
import SpinWheel                   from './components/SpinWheel'
import CoinTimer                   from './components/CoinTimer'
import StreakTracker                from './components/StreakTracker'
import Notifications               from './components/Notifications'
import ReferralPage                from './components/ReferralPage'
import ContactPage                 from './components/ContactPage'
import AdminDashboard              from './components/AdminPanel/AdminDashboard'
import RainEffect                  from './components/RainEffect'
import PushPermissionBanner        from './components/PushPermissionBanner'
import { useSocket }               from './hooks/useSocket'
import { haptics }                 from './utils/haptics'
import { soundEngine }             from './utils/soundEngine'
import { Home, Users, Phone,
         LogOut, Eye, EyeOff,
         LogIn }                   from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import axios                       from 'axios'

axios.defaults.baseURL = 'http://localhost:5000/api'

// ── Login Form ───────────────────────────────────────────────
function LoginForm() {
  const { login }               = useAuth()
  const [form, setForm]         = useState({
    username: '', password: '', remember: false
  })
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(form.username, form.password, form.remember)
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center
                    justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96
                        bg-green-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96
                        bg-green-500/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-[#111] border border-gray-800 rounded-2xl
                        p-8 shadow-2xl">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-white font-black text-3xl">LISA</span>
              <span className="text-green-400 font-black text-3xl">
                SWEEPS
              </span>
            </div>
            <p className="text-gray-500 text-sm tracking-widest uppercase">
              A World of Winners
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label className="text-gray-400 text-sm mb-2 block">
                Username
              </label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="Enter username"
                required
                className="w-full bg-[#1a1a1a] border border-gray-700
                           rounded-xl px-4 py-3 text-white
                           placeholder-gray-600 outline-none
                           focus:border-green-500 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="text-gray-400 text-sm mb-2 block">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder="Enter password"
                  required
                  className="w-full bg-[#1a1a1a] border border-gray-700
                             rounded-xl px-4 py-3 text-white
                             placeholder-gray-600 outline-none pr-12
                             focus:border-green-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2
                             text-gray-500 hover:text-gray-300"
                >
                  {showPass
                    ? <EyeOff size={18} />
                    : <Eye    size={18} />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setForm({ ...form, remember: !form.remember })
                }
                className={`w-5 h-5 rounded border-2 flex items-center
                            justify-center transition-all
                            ${form.remember
                              ? 'bg-green-500 border-green-500'
                              : 'border-gray-600'}`}
              >
                {form.remember && (
                  <svg className="w-3 h-3 text-black" fill="none"
                       viewBox="0 0 24 24" stroke="currentColor"
                       strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                          d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className="text-gray-400 text-sm">Remember me</span>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-red-500/10 border border-red-500/30
                           rounded-xl px-4 py-3 text-red-400
                           text-sm text-center"
              >
                {error}
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-400
                         disabled:bg-green-800 text-black font-bold
                         py-3.5 rounded-xl flex items-center
                         justify-center gap-2 transition-all
                         shadow-lg shadow-green-500/20 active:scale-95"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-black/30
                                border-t-black rounded-full animate-spin" />
              ) : (
                <><LogIn size={18} /> Login</>
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}

// ── Player App Shell ─────────────────────────────────────────
function PlayerApp() {
  const { user, logout }          = useAuth()
  const [tab,        setTab]      = useState('home')
  const [coins,      setCoins]    = useState(user?.coins  || 0)
  const [streak,     setStreak]   = useState(user?.streak || 0)
  const [rainActive, setRainActive] = useState(false)
  const [rainAmount, setRainAmount] = useState(0)
  const [isOnline,   setIsOnline] = useState(navigator.onLine)

  useSocket({
    onRain: (data) => {
      setRainAmount(data.amount)
      setRainActive(true)
      setCoins(prev => prev + data.amount)
      soundEngine.rainSound()
      haptics.rain()
    }
  })

  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online',  on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <RainEffect
        active={rainActive}
        amount={rainAmount}
        onComplete={() => setRainActive(false)}
      />

      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-red-500
                        text-white text-center py-2 text-sm font-bold">
          📡 Reconnecting to Lisa Sweeps...
        </div>
      )}

      <PushPermissionBanner />

      {/* Header */}
      <header className="bg-[#111] border-b border-gray-800 px-4 py-3
                         flex items-center justify-between sticky
                         top-0 z-40">
        <div className="flex items-center gap-1.5">
          <span className="text-white font-black text-xl">LISA</span>
          <span className="text-green-400 font-black text-xl">SWEEPS</span>
        </div>
        <div className="flex items-center gap-3">
          <Notifications />
          <button
            onClick={logout}
            className="text-gray-500 hover:text-white
                       transition-colors p-1"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-24">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {tab === 'home' && (
              <div className="p-4 space-y-5 max-w-lg mx-auto">
                <div className="bg-gradient-to-r from-green-500/10
                                via-transparent to-transparent border
                                border-gray-800/50 rounded-2xl px-4 py-3">
                  <p className="text-white font-semibold">
                    Welcome back,{' '}
                    <span className="text-green-400 font-bold">
                      {user?.username}
                    </span> 👋
                  </p>
                  <p className="text-gray-600 text-xs tracking-widest
                                uppercase mt-0.5">
                    A World of Winners
                  </p>
                </div>
                <CoinTimer onClaim={(bal) => setCoins(bal)} />
                <SpinWheel
                  coins={coins}
                  onCoinsUpdate={setCoins}
                />
                <StreakTracker streak={streak} />
              </div>
            )}
            {tab === 'referral' && <ReferralPage />}
            {tab === 'contact'  && <ContactPage  />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-[#111]
                   border-t border-gray-800 flex items-center
                   justify-around px-4 py-3 z-40"
        style={{
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))'
        }}
      >
        {[
          { id: 'home',     label: 'Home',    icon: Home  },
          { id: 'referral', label: 'Refer',   icon: Users },
          { id: 'contact',  label: 'Support', icon: Phone },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setTab(id); haptics.light() }}
            className={`flex flex-col items-center gap-1 px-6 py-1
                        rounded-xl transition-all duration-200
                        ${tab === id
                          ? 'text-green-400'
                          : 'text-gray-500'}`}
          >
            <Icon size={22} />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── Root App ─────────────────────────────────────────────────
export default function App() {
  const { user, loading }   = useAuth()
  const [splash, setSplash] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 3000)
    return () => clearTimeout(t)
  }, [])

  // Splash
  if (splash) {
    return <SplashScreen onFinish={() => setSplash(false)} />
  }

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center
                      justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-white font-black text-2xl">LISA</span>
            <span className="text-green-400 font-black text-2xl">
              SWEEPS
            </span>
          </div>
          <div className="w-8 h-8 border-2 border-green-500/30
                          border-t-green-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  // Not logged in
  if (!user) return <LoginForm />

  // Admin
  if (user.isAdmin) return <AdminDashboard />

  // Player
  return <PlayerApp />
}