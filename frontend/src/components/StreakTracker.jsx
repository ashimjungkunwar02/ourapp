import { motion } from 'framer-motion'

export default function StreakTracker({ streak = 0 }) {
  const days        = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const currentDay  = streak % 7
  const fullWeeks   = Math.floor(streak / 7)

  return (
    <div className="bg-[#111] border border-gray-800 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold">Daily Streak 🔥</h3>
        <span className="text-green-400 font-bold">{streak} days</span>
      </div>

      {/* Day boxes */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const completed = fullWeeks > 0
            ? true
            : i < currentDay
          const isToday   = i === currentDay && streak % 7 !== 0
          const is7th     = i === 6

          return (
            <motion.div
              key={day}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              className={`flex flex-col items-center gap-1 p-2
                          rounded-xl border
                          ${completed
                            ? 'bg-green-500/20 border-green-500/40'
                            : isToday
                            ? 'bg-yellow-500/10 border-yellow-500/30'
                            : 'bg-gray-800/50 border-gray-700/30'}`}
            >
              <div className="text-base">
                {is7th
                  ? '🎁'
                  : completed
                  ? '✅'
                  : isToday
                  ? '⏳'
                  : '⬜'}
              </div>
              <span className={`text-xs font-medium
                ${completed
                  ? 'text-green-400'
                  : isToday
                  ? 'text-yellow-400'
                  : 'text-gray-500'}`}>
                {day}
              </span>
              {is7th && (
                <span className="text-xs text-yellow-400 font-bold">
                  +3🪙
                </span>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* 7 day reward banner */}
      {streak > 0 && streak % 7 === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 bg-yellow-500/10 border border-yellow-500/30
                     rounded-xl p-3 text-center"
        >
          <p className="text-yellow-400 font-bold text-sm">
            🎉 7-Day Streak Complete!
            You earned 3 Coins + 69% Bonus!
          </p>
        </motion.div>
      )}

      {/* Streak tip */}
      {streak === 0 && (
        <p className="text-gray-600 text-xs text-center mt-3">
          Claim your daily coin to start your streak!
        </p>
      )}

      {streak > 0 && streak % 7 !== 0 && (
        <p className="text-gray-600 text-xs text-center mt-3">
          {7 - (streak % 7)} more days until your streak bonus! 🎁
        </p>
      )}
    </div>
  )
}