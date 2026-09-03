import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import axios from 'axios'

const PRESETS = [40, 50, 60, 69]

export default function BonusProgram() {
  const [mode,     setMode]    = useState(null)
  const [percent,  setPercent] = useState('')
  const [hours,    setHours]   = useState('')
  const [message,  setMessage] = useState('')
  const [loading,  setLoading] = useState(false)
  const [feedback, setFeedback]= useState('')

  const launch = async () => {
    setLoading(true)
    try {
      await axios.post('/admin/bonus/launch', {
        type:       mode,
        percentage: Number(percent),
        validHours: Number(hours),
        message
      })
      setFeedback(`✅ ${percent}% ${mode} bonus launched for ${hours}h!`)
      setMode(null)
      setPercent('')
      setHours('')
      setMessage('')
    } catch (err) {
      setFeedback('❌ ' + (err.response?.data?.message || 'Error'))
    } finally {
      setLoading(false)
    }
    setTimeout(() => setFeedback(''), 4000)
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-green-500/10 border border-green-500/30
                     rounded-xl p-3 text-green-400 text-center text-sm"
        >
          {feedback}
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {!mode ? (
          <motion.div
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-[#111] border border-gray-700 rounded-2xl p-6"
          >
            <h2 className="text-white font-bold text-xl mb-2">
              🎁 Open Bonus Program
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              Choose the type of bonus to activate for all players
            </p>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setMode('deposit')}
                className="bg-[#1a1a1a] border border-gray-600
                           hover:border-green-500/50 rounded-2xl p-6
                           text-center transition-all hover:bg-green-500/5"
              >
                <div className="text-4xl mb-3">💰</div>
                <h3 className="text-white font-bold">Deposit Bonus</h3>
                <p className="text-gray-500 text-xs mt-1">
                  Reward players for depositing
                </p>
              </button>

              <button
                onClick={() => setMode('referral')}
                className="bg-[#1a1a1a] border border-gray-600
                           hover:border-green-500/50 rounded-2xl p-6
                           text-center transition-all hover:bg-green-500/5"
              >
                <div className="text-4xl mb-3">👥</div>
                <h3 className="text-white font-bold">Referral Bonus</h3>
                <p className="text-gray-500 text-xs mt-1">
                  Reward players for referring
                </p>
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-[#111] border border-gray-700 rounded-2xl
                       p-6 space-y-4"
          >
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

            {/* Presets */}
            <div>
              <p className="text-gray-400 text-xs mb-2">Quick presets:</p>
              <div className="flex gap-2 flex-wrap">
                {PRESETS.map(p => (
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
            </div>

            <input
              type="number"
              value={percent}
              onChange={e => setPercent(e.target.value)}
              placeholder="Bonus percentage e.g. 75"
              className="w-full bg-[#1a1a1a] border border-gray-700
                         rounded-xl px-4 py-3 text-white outline-none
                         focus:border-green-500"
            />

            <input
              type="number"
              value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder="Valid for how many hours e.g. 24"
              className="w-full bg-[#1a1a1a] border border-gray-700
                         rounded-xl px-4 py-3 text-white outline-none
                         focus:border-green-500"
            />

            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Notification message for players..."
              rows={3}
              className="w-full bg-[#1a1a1a] border border-gray-700
                         rounded-xl px-4 py-3 text-white outline-none
                         focus:border-green-500 resize-none"
            />

            <button
              onClick={launch}
              disabled={loading || !percent || !hours || !message}
              className="w-full bg-green-500 text-black font-bold
                         py-3.5 rounded-xl hover:bg-green-400
                         disabled:bg-gray-700 disabled:text-gray-500
                         transition-all flex items-center
                         justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-black/30
                                border-t-black rounded-full animate-spin" />
              ) : (
                '🚀 Launch Bonus to All Players'
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}