import { useState, useEffect } from 'react'
import { motion }              from 'framer-motion'
import { gameAPI }               from '../services/api'

export default function CoinTimer({ onClaim }) {
  const [timeLeft, setTimeLeft] = useState(null)
  const [canClaim, setCanClaim] = useState(false)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!timeLeft || timeLeft <= 0) return
    const tick = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setCanClaim(true)
          clearInterval(tick)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [timeLeft])

  const fetchStatus = async () => {
    try {
      const res = await gameAPI.coinStatus()
      if (res.data.canClaim) {
        setCanClaim(true)
        setTimeLeft(0)
      } else {
        setCanClaim(false)
        setTimeLeft(res.data.secondsLeft)
      }
    } catch (err) {
      console.error('Coin status error:', err.message)
    }
  }

  const handleClaim = async () => {
    setClaiming(true)
    try {
      const res = await gameAPI.claimCoin()
      onClaim(res.data.newBalance)
      setCanClaim(false)
      setTimeLeft(3600)
    } catch (err) {
      console.error('Claim error:', err.message)
    } finally {
      setClaiming(false)
    }
  }

  const formatTime = (secs) => {
    if (!secs) return '00:00:00'
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return [h, m, s]
      .map(v => String(v).padStart(2, '0'))
      .join(':')
  }

  return (
    <div className="bg-[#111] border border-gray-800 rounded-2xl
                    p-5 text-center">
      <h3 className="text-gray-400 text-sm uppercase tracking-wider mb-3">
        🪙 Free Coin
      </h3>

      {canClaim ? (
        <motion.button
          whileTap={{ scale: 0.95 }}
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          onClick={handleClaim}
          disabled={claiming}
          className="w-full bg-yellow-500 hover:bg-yellow-400
                     text-black font-bold py-3 rounded-xl
                     transition-all shadow-lg shadow-yellow-500/20"
        >
          {claiming ? 'Claiming...' : '🎁 Claim Free Coin!'}
        </motion.button>
      ) : (
        <div>
          <div className="text-green-400 font-mono text-3xl font-bold mb-1">
            {timeLeft !== null ? formatTime(timeLeft) : '--:--:--'}
          </div>
          <p className="text-gray-600 text-xs">
            Next free coin available in
          </p>
        </div>
      )}
    </div>
  )
}