import { useState, useEffect } from 'react'
import { Plus, Minus, RotateCcw, Search } from 'lucide-react'
import { adminAPI } from '../../services/api'

export default function UserManagement() {
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
      const res = await adminAPI.getUsers()
      setUsers(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const showFeedback = (msg) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 3000)
  }

  const createUser = async () => {
    try {
      await adminAPI.createUser(newUser.username, newUser.password)
      showFeedback('✅ User created successfully!')
      setNewUser({ username: '', password: '' })
      fetchUsers()
    } catch (err) {
      showFeedback('❌ ' + (err.response?.data?.message || 'Error'))
    }
  }

  const adjustPoints = async (userId, amount, type) => {
    if (!amount) return
    try {
      await adminAPI.adjustPoints(userId, Number(amount), type)
      showFeedback(`✅ Points ${type === 'add' ? 'added' : 'deducted'}!`)
      fetchUsers()
    } catch {
      showFeedback('❌ Error adjusting points')
    }
  }

  const resetPassword = async (userId) => {
    const password = passMap[userId]
    if (!password) return
    try {
      await adminAPI.resetPassword(userId, password)
      showFeedback('✅ Password reset successfully!')
      setPassMap({ ...passMap, [userId]: '' })
    } catch {
      showFeedback('❌ Error resetting password')
    }
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
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Plus size={18} className="text-green-400" />
          Create New User
        </h3>
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
        <div className="relative mb-4">
          <Search size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2
                             text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full bg-[#1a1a1a] border border-gray-700
                       rounded-xl pl-9 pr-4 py-2.5 text-white
                       outline-none focus:border-green-500 text-sm"
          />
        </div>

        <div className="space-y-3 max-h-[500px] overflow-y-auto">
          {loading ? (
            <p className="text-gray-500 text-center py-8">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No users found</p>
          ) : filtered.map(user => (
            <div key={user._id}
                 className="bg-[#1a1a1a] rounded-xl p-4
                            border border-gray-700/50">
              {/* User Info */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-white font-medium">
                    {user.username}
                  </span>
                  <span className="ml-2 text-gray-500 text-xs">
                    Streak: {user.streak}d
                  </span>
                </div>
                <span className="text-yellow-400 font-bold text-sm">
                  🪙 {user.coins}
                </span>
              </div>

              <p className="text-gray-600 text-xs mb-3">
                Joined: {new Date(user.createdAt).toLocaleDateString()}
                {' '}• Spins: {user.totalSpins || 0}
              </p>

              {/* Points Controls */}
              <div className="flex gap-2 mb-2 flex-wrap">
                <input
                  type="number"
                  placeholder="Amount"
                  value={pointsMap[user._id] || ''}
                  onChange={e => setPointsMap({
                    ...pointsMap,
                    [user._id]: e.target.value
                  })}
                  className="bg-[#0a0a0a] border border-gray-700
                             rounded-lg px-3 py-1.5 text-white
                             text-xs w-24 outline-none"
                />
                <button
                  onClick={() =>
                    adjustPoints(user._id, pointsMap[user._id], 'add')
                  }
                  className="bg-green-500/20 text-green-400 border
                             border-green-500/30 px-3 py-1.5 rounded-lg
                             text-xs hover:bg-green-500/30 transition-all
                             flex items-center gap-1"
                >
                  <Plus size={10} /> Add
                </button>
                <button
                  onClick={() =>
                    adjustPoints(user._id, pointsMap[user._id], 'deduct')
                  }
                  className="bg-red-500/20 text-red-400 border
                             border-red-500/30 px-3 py-1.5 rounded-lg
                             text-xs hover:bg-red-500/30 transition-all
                             flex items-center gap-1"
                >
                  <Minus size={10} /> Deduct
                </button>
              </div>

              {/* Reset Password */}
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="New password"
                  value={passMap[user._id] || ''}
                  onChange={e => setPassMap({
                    ...passMap,
                    [user._id]: e.target.value
                  })}
                  className="bg-[#0a0a0a] border border-gray-700
                             rounded-lg px-3 py-1.5 text-white
                             text-xs flex-1 outline-none"
                />
                <button
                  onClick={() => resetPassword(user._id)}
                  className="bg-orange-500/20 text-orange-400 border
                             border-orange-500/30 px-3 py-1.5 rounded-lg
                             text-xs hover:bg-orange-500/30 transition-all
                             flex items-center gap-1"
                >
                  <RotateCcw size={10} /> Reset
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}