import { useState, useEffect } from 'react'
import { motion }              from 'framer-motion'
import { adminAPI }            from '../../services/api'

function BarChart({ data = [], color = '#22c55e', label }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div>
      <p className="text-gray-400 text-xs mb-3 uppercase tracking-wider">
        {label}
      </p>
      <div className="flex items-end gap-1.5 h-24">
        {data.map((d, i) => {
          const height = ((d.value / max) * 100)
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-gray-600" style={{ fontSize: 9 }}>
                {d.value > 0 ? d.value : ''}
              </span>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${height}%` }}
                transition={{ delay: i * 0.05, duration: 0.5 }}
                className="w-full rounded-t-sm min-h-[2px]"
                style={{ backgroundColor: color }}
              />
              <span className="text-gray-600" style={{ fontSize: 9 }}>
                {i + 1}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range,   setRange]   = useState('7d')

  useEffect(() => {
    fetchMetrics()
  }, [range])

  const fetchMetrics = async () => {
    try {
      const res = await adminAPI.getMetrics(range)
      setMetrics(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-green-500/30
                      border-t-green-500 rounded-full animate-spin" />
    </div>
  )

  if (!metrics) return (
    <div className="text-gray-500 text-center py-8">
      No metrics available
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Range selector */}
      <div className="flex gap-2">
        {['7d', '30d', 'all'].map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium
                        transition-all
                        ${range === r
                          ? 'bg-green-500 text-black'
                          : 'bg-[#1a1a1a] text-gray-400 border border-gray-700'}`}
          >
            {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : 'All Time'}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total Users',  value: metrics.totalUsers,  icon: '👥', color: 'text-blue-400'   },
          { label: 'Active Today', value: metrics.activeToday, icon: '🟢', color: 'text-green-400'  },
          { label: 'Total Spins',  value: metrics.totalSpins,  icon: '🎡', color: 'text-purple-400' },
          { label: 'FP Paid Out',  value: `$${metrics.totalFPPaid || 0}`, icon: '💰', color: 'text-yellow-400' },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-[#111] border border-gray-700 rounded-2xl p-4"
          >
            <span className="text-xl">{kpi.icon}</span>
            <p className={`font-black text-2xl mt-2 ${kpi.color}`}>
              {kpi.value}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">{kpi.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Live Stats */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-3 flex items-center gap-2">
          🔴 Live Stats
          <span className="w-2 h-2 bg-red-500 rounded-full
                           animate-pulse inline-block" />
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: 'Online Now',     value: metrics.onlineNow || 0,          color: 'text-green-400'  },
            { label: 'Spins Today',    value: metrics.spinsToday || 0,         color: 'text-purple-400' },
            { label: 'Coins Claimed',  value: metrics.coinsClaimedToday || 0,  color: 'text-yellow-400' },
            { label: 'FP Today',       value: `$${metrics.fpToday || 0}`,      color: 'text-orange-400' },
          ].map(s => (
            <div key={s.label} className="bg-[#1a1a1a] rounded-xl p-3">
              <p className="text-gray-500 text-xs">{s.label}</p>
              <p className={`font-bold text-xl ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-5">Daily Active Users</h3>
        <BarChart
          data={metrics.dauChart || []}
          color="#22c55e"
          label="Users per day"
        />
      </div>

      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-5">Spins Per Day</h3>
        <BarChart
          data={metrics.spinsChart || []}
          color="#a855f7"
          label="Spins per day"
        />
      </div>

      {/* House Edge */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-2">
          House Edge Analysis
        </h3>
        <p className="text-gray-500 text-xs mb-4">
          Keep FP Payout Rate below 5% for healthy margins
        </p>

        <div className="space-y-3">
          {[
            { label: 'FP Payout Rate', value: metrics.fpPayoutRate || 0,  color: '#f59e0b', max: 10  },
            { label: 'Bonus Rate',     value: metrics.bonusRate    || 0,  color: '#8b5cf6', max: 100 },
            { label: 'Retention Rate', value: metrics.retentionRate|| 0,  color: '#22c55e', max: 100 },
          ].map(item => (
            <div key={item.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">{item.label}</span>
                <span className="text-white font-bold">{item.value}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: item.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((item.value / item.max) * 100, 100)}%` }}
                  transition={{ duration: 1 }}
                />
              </div>
            </div>
          ))}
        </div>

        {metrics.fpPayoutRate > 5 ? (
          <div className="mt-4 bg-red-500/10 border border-red-500/30
                          rounded-xl p-3 text-center">
            <p className="text-red-400 text-sm font-medium">
              ⚠️ FP Payout Rate is high! Consider adjusting probabilities.
            </p>
          </div>
        ) : (
          <div className="mt-4 bg-green-500/10 border border-green-500/30
                          rounded-xl p-3 text-center">
            <p className="text-green-400 text-sm font-medium">
              ✅ House edge is sustainable!
            </p>
          </div>
        )}
      </div>
    </div>
  )
}