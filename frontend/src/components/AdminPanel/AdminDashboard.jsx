import { useState, useEffect }  from 'react'
import { motion }               from 'framer-motion'
import { Users, Activity, Gift,
         BarChart2, CloudRain,
         LogOut }               from 'lucide-react'
import { useNavigate }          from 'react-router-dom'

// ── Standalone panels ───────────────────────────────────────────────────────
// These four files existed alongside near-identical copies nested at the bottom
// of this same file. The nested copies shadowed the imports (same identifier in
// the same module scope), so the standalone files were never rendered and any
// fix applied to them silently did nothing. Only the imported versions remain.
import UserManagement   from './UserManagement'
import BonusProgram     from './BonusProgram'
import RecentActivities from './RecentActivities'
import MetricsDashboard from './MetricsDashboard'

import { adminAPI }     from '../../services/api'
import { useAuth }      from '../../context/AuthContext'

const TABS = [
  { id: 'users',      label: 'Users',    icon: Users      },
  { id: 'bonus',      label: 'Bonus',    icon: Gift       },
  { id: 'activities', label: 'Activity', icon: Activity   },
  { id: 'metrics',    label: 'Metrics',  icon: BarChart2  },
]

const RAIN_MIN = 1
const RAIN_MAX = 100

export default function AdminDashboard() {
  const navigate    = useNavigate()
  const { logout }  = useAuth()

  const [tab,         setTab]        = useState('users')
  const [stats,       setStats]      = useState({
    totalUsers: 0, activeToday: 0, totalSpins: 0
  })
  const [rainInput,   setRainInput]  = useState('')
  const [showRainUI,  setShowRainUI] = useState(false)
  const [rainLoading, setRainLoading]= useState(false)
  const [feedback,    setFeedback]   = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await adminAPI.getStats()
      setStats(res.data)
    } catch (err) {
      console.error('Stats error:', err.message)
    }
  }

  const showFeedbackMessage = (msg) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 4000)
  }

  const makeItRain = async () => {
    // Mirror the server-side rule so the admin gets an immediate, clear message
    // instead of a 400 from the API. Number('') is 0 and Number('abc') is NaN,
    // so both must be rejected explicitly here.
    const amount = Number(rainInput)

    if (!Number.isInteger(amount) || amount < RAIN_MIN || amount > RAIN_MAX) {
      showFeedbackMessage(
        `❌ Amount must be a whole number between ${RAIN_MIN} and ${RAIN_MAX}`
      )
      return
    }

    setRainLoading(true)
    try {
      const res = await adminAPI.makeItRain(amount)
      setShowRainUI(false)
      setRainInput('')
      showFeedbackMessage(
        `✅ Rained ${amount} coin${amount > 1 ? 's' : ''} to ` +
        `${res.data?.usersAffected ?? 'all'} users!`
      )
      fetchStats()
    } catch (err) {
      showFeedbackMessage('❌ Error: ' + (err.response?.data?.message || 'Failed'))
    } finally {
      setRainLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="min-w-0">
            <h1 className="text-white font-black text-2xl">Admin Panel</h1>
            <p className="text-gray-500 text-sm">Lisa Sweeps Management</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Rain Button */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowRainUI(true)}
              className="flex items-center gap-2 bg-yellow-500/10
                         border border-yellow-500/30 hover:bg-yellow-500/20
                         text-yellow-400 px-4 py-2.5 rounded-xl
                         font-bold text-sm transition-all"
            >
              <CloudRain size={18} />
              <span className="hidden sm:inline">Make it Rain</span>
              <span aria-hidden="true">🌧️</span>
            </motion.button>

            {/* Logout — the admin view previously had no way to sign out. */}
            <button
              onClick={handleLogout}
              aria-label="Log out"
              className="text-gray-500 hover:text-white transition-colors
                         p-2.5 hover:bg-white/5 rounded-xl border
                         border-gray-800"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Rain Modal */}
        {showRainUI && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center
                          justify-center p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[#111] border border-yellow-500/30 rounded-3xl
                         p-8 max-w-sm w-full text-center"
            >
              <div className="text-5xl mb-4" aria-hidden="true">🌧️</div>
              <h2 className="text-white font-black text-2xl mb-2">
                Make It Rain!
              </h2>
              <p className="text-gray-400 text-sm mb-6">
                Give every user {RAIN_MIN}&ndash;{RAIN_MAX} coins instantly
              </p>

              <div className="flex gap-2 mb-3 flex-wrap justify-center">
                {[1, 2, 5, 10].map(n => (
                  <button
                    key={n}
                    onClick={() => setRainInput(String(n))}
                    className={`px-4 py-2 rounded-xl font-bold text-sm
                                border transition-all
                                ${rainInput === String(n)
                                  ? 'bg-yellow-500 border-yellow-500 text-black'
                                  : 'border-gray-600 text-gray-300'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <input
                type="number"
                min={RAIN_MIN}
                max={RAIN_MAX}
                step={1}
                value={rainInput}
                onChange={e => setRainInput(e.target.value)}
                placeholder="Custom amount..."
                className="w-full bg-[#1a1a1a] border border-gray-700
                           rounded-xl px-4 py-3 text-white outline-none
                           focus:border-yellow-500 text-center text-lg
                           font-bold mb-4"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => setShowRainUI(false)}
                  className="flex-1 bg-gray-800 text-gray-300 py-3
                             rounded-xl font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={makeItRain}
                  disabled={rainLoading || !rainInput}
                  className="flex-1 bg-yellow-500 text-black py-3
                             rounded-xl font-bold hover:bg-yellow-400
                             disabled:bg-gray-700 disabled:text-gray-500
                             transition-all"
                >
                  {rainLoading ? '...' : 'Rain!'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className="mb-4 bg-green-500/10 border border-green-500/30
                          rounded-xl p-3 text-green-400 text-center text-sm">
            {feedback}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Users',  value: stats.totalUsers,  icon: '👥' },
            { label: 'Active Today', value: stats.activeToday, icon: '🟢' },
            { label: 'Total Spins',  value: stats.totalSpins,  icon: '🎡' },
          ].map(s => (
            <div key={s.label}
                 className="bg-[#111] border border-gray-700 rounded-2xl
                            p-4 text-center">
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="text-white font-bold text-xl">{s.value}</div>
              <div className="text-gray-500 text-xs">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-6 bg-[#111] border border-gray-700
                        p-1 rounded-2xl overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center
                            gap-1.5 py-2.5 rounded-xl font-medium
                            text-sm transition-all duration-200 whitespace-nowrap
                            ${tab === t.id
                              ? 'bg-green-500 text-black'
                              : 'text-gray-400 hover:text-white'}`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'users'      && <UserManagement   />}
          {tab === 'bonus'      && <BonusProgram     />}
          {tab === 'activities' && <RecentActivities />}
          {tab === 'metrics'    && <MetricsDashboard />}
        </motion.div>
      </div>
    </div>
  )
}
