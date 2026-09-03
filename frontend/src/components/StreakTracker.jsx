import { motion } from 'framer-motion'

export default function StreakTracker({ streak = 0 }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // BUG FIX: this used to be
  //     const currentDay = streak % 7
  //     const fullWeeks  = Math.floor(streak / 7)
  //     const completed  = fullWeeks > 0 ? true : i < currentDay
  // so from streak 7 onwards `fullWeeks > 0` was permanently true and ALL seven
  // boxes rendered as complete — at streak 8 the tracker claimed a full week
  // when the user was one day into the next cycle, and it never reset.
  //
  // The widget shows progress through the CURRENT 7-day cycle, so it must be
  // derived from the remainder alone. The one special case: a positive streak
  // that is an exact multiple of 7 means the cycle just COMPLETED (all 7 boxes
  // filled and the reward earned), not that zero days are done.
  const completedWeeks = Math.floor(streak / 7)
  const weekProgress   = streak <= 0
    ? 0
    : streak % 7 === 0
      ? 7
      : streak % 7

  const weekComplete = weekProgress === 7
  const daysToReward = 7 - weekProgress

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
          const completed = i < weekProgress
          // "Today" is the next box to fill, and only while the cycle is open.
          const isToday   = !weekComplete && i === weekProgress
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

      {/* 7 day reward banner — fires on every completed cycle, not just the first */}
      {weekComplete && (
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
          {completedWeeks > 1 && (
            <p className="text-yellow-600 text-xs mt-1">
              {completedWeeks} cycles completed in a row
            </p>
          )}
        </motion.div>
      )}

      {/* Streak tip */}
      {streak === 0 && (
        <p className="text-gray-600 text-xs text-center mt-3">
          Claim your daily coin to start your streak!
        </p>
      )}

      {streak > 0 && !weekComplete && (
        <p className="text-gray-600 text-xs text-center mt-3">
          {daysToReward} more day{daysToReward === 1 ? '' : 's'} until your streak bonus! 🎁
        </p>
      )}
    </div>
  )
}
