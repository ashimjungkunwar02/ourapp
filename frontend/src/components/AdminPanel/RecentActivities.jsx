import { useState, useEffect } from 'react'
import axios from 'axios'

export default function RecentActivities() {
  const [activities, setActivities] = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    fetchActivities()
    const interval = setInterval(fetchActivities, 30000)
    return () => clearInterval(interval)
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
    spin:     '🎡',
    claim:    '🪙',
    login:    '🔑',
    bonus:    '🎁',
    referral: '👥',
    win:      '💰',
    admin:    '⚙️'
  }

  return (
    <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold">Recent Activities</h3>
        <span className="text-gray-500 text-xs">Last 20 events</span>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="w-8 h-8 border-2 border-green-500/30
                          border-t-green-500 rounded-full animate-spin
                          mx-auto" />
        </div>
      ) : activities.length === 0 ? (
        <p className="text-gray-500 text-center py-8 text-sm">
          No activities yet
        </p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {activities.map((a, i) => (
            <div
              key={a._id || i}
              className="flex items-center gap-3 bg-[#1a1a1a]
                         rounded-xl p-3 border border-gray-700/30"
            >
              <span className="text-xl">
                {icons[a.type] || '📋'}
              </span>
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