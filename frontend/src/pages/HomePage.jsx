import { useState, useEffect } from 'react'
import SpinWheel    from '../components/SpinWheel'
import CoinTimer    from '../components/CoinTimer'
import StreakTracker from '../components/StreakTracker'
import { useAuth }  from '../context/AuthContext'

export default function HomePage() {
  const { user, fetchProfile } = useAuth()
  const [coins,  setCoins]     = useState(user?.coins  || 0)
  const [streak, setStreak]    = useState(user?.streak || 0)

  useEffect(() => {
    if (user) {
      setCoins(user.coins   || 0)
      setStreak(user.streak || 0)
    }
  }, [user])

  const handleCoinClaimed = (newBalance) => {
    setCoins(newBalance)
    fetchProfile()
  }

  const handleCoinsUpdate = (newBalance) => {
    setCoins(newBalance)
  }

  return (
    <div className="p-4 space-y-5 max-w-lg mx-auto">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-green-500/10 via-transparent
                      to-transparent border border-gray-800/50 rounded-2xl
                      px-4 py-3">
        <p className="text-white font-semibold">
          Welcome back,{' '}
          <span className="text-green-400 font-bold">{user?.username}</span> 👋
        </p>
        <p className="text-gray-600 text-xs tracking-widest uppercase mt-0.5">
          A World of Winners
        </p>
      </div>

      {/* Coin Timer */}
      <CoinTimer onClaim={handleCoinClaimed} />

      {/* Spin Wheel */}
      <SpinWheel
        coins={coins}
        onCoinsUpdate={handleCoinsUpdate}
      />

      {/* Streak Tracker */}
      <StreakTracker streak={streak} />
    </div>
  )
}