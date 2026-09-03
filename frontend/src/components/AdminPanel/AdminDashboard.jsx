import { useState, useEffect }  from 'react'
import { motion }               from 'framer-motion'
import { Users, Activity, Gift,
         BarChart2, CloudRain } from 'lucide-react'
import axios                    from 'axios'

const TABS = [
  { id: 'users',      label: 'Users',    icon: Users    },
  { id: 'bonus',      label: 'Bonus',    icon: Gift     },
  { id: 'activities', label: 'Activity', icon: Activity },
]

export default function AdminDashboard() {
  const [tab,         setTab]        = useState('users')
  const [stats,       setStats]      = useState({
    totalUsers: 0, activeToday: 0, totalSpins: 0
  })
  const [rainActive,  setRainActive] = useState(false)
  const [rainInput,   setRainInput]  = useState('')
  const [showRainUI,  setShowRainUI] = useState(false)
  const [rainLoading, setRainLoading]= useState(false)
  const [feedback,    setFeedback]   = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await axios.get('/admin/stats')
      setStats(res.data)
    } catch (err) {
      console.error('Stats error:', err.message)
    }
  }

  const makeItRain = async () => {
    const amount = Number(rainInput) || 5
    setRainLoading(true)
    try {
      await axios.post('/admin/rain', { amount })
      setShowRainUI(false)
      setRainInput('')
      setFeedback(`✅ Rained ${amount} coins to all users!`)
      setTimeout(() => setFeedback(''), 4000)
    } catch (err) {
      setFeedback('❌ Error: ' + (err.response?.data?.message || 'Failed'))
    } finally {
      setRainLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white font-black text-2xl">Admin Panel</h1>
            <p className="text-gray-500 text-sm">Lisa Sweeps Management</p>
          </div>

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
            Make it Rain 🌧️
          </motion.button>
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
              <div className="text-5xl mb-4">🌧️</div>
              <h2 className="text-white font-black text-2xl mb-2">
                Make It Rain!
              </h2>
              <p className="text-gray-400 text-sm mb-6">
                Give every user coins instantly
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
                    {n} 🪙
                  </button>
                ))}
              </div>

              <input
                type="number"
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
                  {rainLoading ? '...' : '🌧️ Rain!'}
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
                        p-1 rounded-2xl">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center
                            gap-1.5 py-2.5 rounded-xl font-medium
                            text-sm transition-all duration-200
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
          {tab === 'users'      && <UserManagement />}
          {tab === 'bonus'      && <BonusProgram   />}
          {tab === 'activities' && <RecentActivities />}
        </motion.div>
      </div>
    </div>
  )
}

// ── User Management ───────────────────────────────────────────
function UserManagement() {
  const [users,     setUsers]    = useState([])
  const [search,    setSearch]   = useState('')
  const [loading,   setLoading]  = useState(false)
  const [newUser,   setNewUser]  = useState({ username: '', password: '' })
  const [pointsMap, setPointsMap]= useState({})
  const [passMap,   setPassMap]  = useState({})
  const [feedback,  setFeedback] = useState('')

  useEffect(() => { fetchUsers() }, [])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/admin/users')
      setUsers(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const createUser = async () => {
    try {
      await axios.post('/admin/users/create', newUser)
      setFeedback('✅ User created!')
      setNewUser({ username: '', password: '' })
      fetchUsers()
    } catch (err) {
      setFeedback('❌ ' + (err.response?.data?.message || 'Error'))
    }
    setTimeout(() => setFeedback(''), 3000)
  }

  const adjustPoints = async (userId, amount, type) => {
    try {
      await axios.post(`/admin/users/${userId}/points`, {
        amount: Number(amount), type
      })
      setFeedback(`✅ Points ${type === 'add' ? 'added' : 'deducted'}!`)
      fetchUsers()
    } catch {
      setFeedback('❌ Error')
    }
    setTimeout(() => setFeedback(''), 3000)
  }

  const resetPassword = async (userId, password) => {
    try {
      await axios.post(`/admin/users/${userId}/reset-password`, { password })
      setFeedback('✅ Password reset!')
    } catch {
      setFeedback('❌ Error')
    }
    setTimeout(() => setFeedback(''), 3000)
  }

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="bg-green-500/10 border border-green-500/30
                        rounded-xl p-3 text-green-400 text-center text-sm">
          {feedback}
        </div>
      )}

      {/* Create User */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-4">➕ Create New User</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            value={newUser.username}
            onChange={e => setNewUser({ ...newUser, username: e.target.value })}
            placeholder="Username"
            className="bg-[#1a1a1a] border border-gray-700 rounded-xl
                       px-4 py-2.5 text-white outline-none
                       focus:border-green-500 text-sm"
          />
          <input
            type="password"
            value={newUser.password}
            onChange={e => setNewUser({ ...newUser, password: e.target.value })}
            placeholder="Password"
            className="bg-[#1a1a1a] border border-gray-700 rounded-xl
                       px-4 py-2.5 text-white outline-none
                       focus:border-green-500 text-sm"
          />
        </div>
        <button
          onClick={createUser}
          disabled={!newUser.username || !newUser.password}
          className="w-full bg-green-500 text-black font-bold py-2.5
                     rounded-xl hover:bg-green-400 disabled:bg-gray-700
                     disabled:text-gray-500 transition-all text-sm"
        >
          Create User
        </button>
      </div>

      {/* User List */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search users..."
          className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl
                     px-4 py-2.5 text-white outline-none
                     focus:border-green-500 text-sm mb-4"
        />

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {loading ? (
            <p className="text-gray-500 text-center py-4">Loading...</p>
          ) : filtered.map(user => (
            <div key={user._id}
                 className="bg-[#1a1a1a] rounded-xl p-4
                            border border-gray-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">
                  {user.username}
                </span>
                <span className="text-yellow-400 font-bold">
                  🪙 {user.coins}
                </span>
              </div>

              <p className="text-gray-500 text-xs mb-3">
                Streak: {user.streak} days
              </p>

              {/* Points */}
              <div className="flex gap-2 mb-2 flex-wrap">
                <input
                  type="number"
                  placeholder="Amount"
                  value={pointsMap[user._id] || ''}
                  onChange={e => setPointsMap({
                    ...pointsMap, [user._id]: e.target.value
                  })}
                  className="bg-[#0a0a0a] border border-gray-700
                             rounded-lg px-3 py-1.5 text-white
                             text-xs w-24 outline-none"
                />
                <button
                  onClick={() => adjustPoints(
                    user._id, pointsMap[user._id], 'add'
                  )}
                  className="bg-green-500/20 text-green-400 border
                             border-green-500/30 px-3 py-1.5 rounded-lg
                             text-xs hover:bg-green-500/30 transition-all"
                >
                  + Add
                </button>
                <button
                  onClick={() => adjustPoints(
                    user._id, pointsMap[user._id], 'deduct'
                  )}
                  className="bg-red-500/20 text-red-400 border
                             border-red-500/30 px-3 py-1.5 rounded-lg
                             text-xs hover:bg-red-500/30 transition-all"
                >
                  - Deduct
                </button>
              </div>

              {/* Reset Password */}
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="New password"
                  value={passMap[user._id] || ''}
                  onChange={e => setPassMap({
                    ...passMap, [user._id]: e.target.value
                  })}
                  className="bg-[#0a0a0a] border border-gray-700
                             rounded-lg px-3 py-1.5 text-white
                             text-xs flex-1 outline-none"
                />
                <button
                  onClick={() => resetPassword(user._id, passMap[user._id])}
                  className="bg-orange-500/20 text-orange-400 border
                             border-orange-500/30 px-3 py-1.5 rounded-lg
                             text-xs hover:bg-orange-500/30 transition-all"
                >
                  Reset
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Bonus Program ─────────────────────────────────────────────
function BonusProgram() {
  const [mode,    setMode]    = useState(null)
  const [percent, setPercent] = useState('')
  const [hours,   setHours]   = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback,setFeedback]= useState('')

  const launch = async () => {
    setLoading(true)
    try {
      await axios.post('/admin/bonus/launch', {
        type:       mode,
        percentage: Number(percent),
        validHours: Number(hours),
        message
      })
      setFeedback(`✅ ${percent}% ${mode} bonus launched!`)
      setMode(null)
      setPercent('')
      setHours('')
      setMessage('')
    } catch {
      setFeedback('❌ Error launching bonus')
    } finally {
      setLoading(false)
    }
    setTimeout(() => setFeedback(''), 4000)
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="bg-green-500/10 border border-green-500/30
                        rounded-xl p-3 text-green-400 text-center text-sm">
          {feedback}
        </div>
      )}

      {!mode ? (
        <div className="bg-[#111] border border-gray-700 rounded-2xl p-6">
          <h2 className="text-white font-bold text-xl mb-6">
            🎁 Open Bonus Program
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setMode('deposit')}
              className="bg-[#1a1a1a] border border-gray-600
                         hover:border-green-500/50 rounded-2xl p-6
                         text-center transition-all"
            >
              <div className="text-4xl mb-3">💰</div>
              <h3 className="text-white font-bold">Deposit Bonus</h3>
            </button>
            <button
              onClick={() => setMode('referral')}
              className="bg-[#1a1a1a] border border-gray-600
                         hover:border-green-500/50 rounded-2xl p-6
                         text-center transition-all"
            >
              <div className="text-4xl mb-3">👥</div>
              <h3 className="text-white font-bold">Referral Bonus</h3>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-[#111] border border-gray-700 rounded-2xl p-6
                        space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold text-xl">
              {mode === 'deposit' ? '💰 Deposit' : '👥 Referral'} Bonus
            </h2>
            <button
              onClick={() => setMode(null)}
              className="text-gray-500 hover:text-white text-sm"
            >
              ← Back
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {[40, 50, 60, 69].map(p => (
              <button
                key={p}
                onClick={() => setPercent(String(p))}
                className={`px-4 py-2 rounded-xl font-bold text-sm
                            border transition-all
                            ${percent === String(p)
                              ? 'bg-green-500 border-green-500 text-black'
                              : 'border-gray-600 text-gray-300'}`}
              >
                {p}%
              </button>
            ))}
          </div>

          <input
            type="number"
            value={percent}
            onChange={e => setPercent(e.target.value)}
            placeholder="Bonus percentage"
            className="w-full bg-[#1a1a1a] border border-gray-700
                       rounded-xl px-4 py-3 text-white outline-none
                       focus:border-green-500"
          />

          <input
            type="number"
            value={hours}
            onChange={e => setHours(e.target.value)}
            placeholder="Valid for (hours)"
            className="w-full bg-[#1a1a1a] border border-gray-700
                       rounded-xl px-4 py-3 text-white outline-none
                       focus:border-green-500"
          />

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Notification message..."
            rows={3}
            className="w-full bg-[#1a1a1a] border border-gray-700
                       rounded-xl px-4 py-3 text-white outline-none
                       focus:border-green-500 resize-none"
          />

          <button
            onClick={launch}
            disabled={loading || !percent || !hours || !message}
            className="w-full bg-green-500 text-black font-bold py-3.5
                       rounded-xl hover:bg-green-400 disabled:bg-gray-700
                       disabled:text-gray-500 transition-all"
          >
            {loading ? '...' : '🚀 Launch Bonus to All Players'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Recent Activities ─────────────────────────────────────────
function RecentActivities() {
  const [activities, setActivities] = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    fetchActivities()
  }, [])

  const fetchActivities = async () => {
    try {
      const res = await axios.get('/admin/activities')
      setActivities(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const icons = {
    spin: '🎡', claim: '🪙', login: '🔑',
    bonus: '🎁', referral: '👥', win: '💰', admin: '⚙️'
  }

  return (
    <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
      <h3 className="text-white font-bold mb-4">Recent Activities</h3>

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading...</p>
      ) : activities.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No activities yet</p>
      ) : (
        <div className="space-y-2">
          {activities.map((a, i) => (
            <div key={a._id || i}
                 className="flex items-center gap-3 bg-[#1a1a1a]
                            rounded-xl p-3 border border-gray-700/30">
              <span className="text-xl">{icons[a.type] || '📋'}</span>
              <div className="flex-1">
                <p className="text-white text-sm">
                  <span className="text-green-400 font-medium">
                    {a.username}
                  </span>
                  {' '}{a.description}
                </p>
                <p className="text-gray-600 text-xs">
                  {new Date(a.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}