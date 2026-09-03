import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function RainEffect({ active, amount, onComplete }) {
  const [coins, setCoins] = useState([])

  useEffect(() => {
    if (!active) return

    const newCoins = Array.from({ length: 40 }, (_, i) => ({
      id:       i,
      x:        Math.random() * 100,
      delay:    Math.random() * 1.5,
      duration: 1.5 + Math.random(),
      size:     16 + Math.random() * 16,
    }))
    setCoins(newCoins)

    const t = setTimeout(() => {
      setCoins([])
      onComplete?.()
    }, 4000)

    return () => clearTimeout(t)
  }, [active])

  return (
    <AnimatePresence>
      {active && (
        <div className="fixed inset-0 pointer-events-none z-[100]
                        overflow-hidden">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Falling coins */}
          {coins.map(coin => (
            <motion.div
              key={coin.id}
              initial={{ top: '-5%', left: `${coin.x}%`, opacity: 1 }}
              animate={{ top: '105%', opacity: [1, 1, 0] }}
              transition={{
                duration: coin.duration,
                delay:    coin.delay,
                ease:     'easeIn'
              }}
              className="absolute select-none"
              style={{ fontSize: coin.size }}
            >
              🪙
            </motion.div>
          ))}

          {/* Center card */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0.5, delay: 0.3 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2
                       -translate-y-1/2 bg-[#111] border-2
                       border-yellow-400 rounded-3xl p-8 text-center
                       shadow-2xl shadow-yellow-500/20 min-w-[280px]"
          >
            <motion.div
              animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
              transition={{ repeat: Infinity, duration: 0.5 }}
              className="text-6xl mb-4"
            >
              🌧️
            </motion.div>

            <h2 className="text-white font-black text-3xl mb-2">
              IT'S RAINING!
            </h2>
            <p className="text-yellow-400 font-bold text-xl mb-1">
              +{amount} Coins
            </p>
            <p className="text-gray-400 text-sm">
              Admin made it rain! 🎉
            </p>

            <div className="mt-4 h-1 bg-gray-700 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-yellow-400 rounded-full"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 3.5, ease: 'linear' }}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}