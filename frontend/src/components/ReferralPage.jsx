import { useState, useEffect } from 'react'
import { motion }              from 'framer-motion'
import { Copy, Share2, Users } from 'lucide-react'
import { referralAPI }          from '../services/api'
import { useAuth }             from '../context/AuthContext'

export default function ReferralPage() {
  const { user }            = useAuth()
  const [stats, setStats]   = useState({ referrals: 0, earned: 0 })
  const [copied, setCopied] = useState(false)

  const referralLink = `${window.location.origin}?ref=${user?.referralCode || ''}`

  useEffect(() => {
    referralAPI.getStats()
      .then(r => setStats(r.data))
      .catch(console.error)
  }, [])

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const shareLink = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Join Lisa Sweeps!',
        text:  'Join me on Lisa Sweeps and spin to win!',
        url:   referralLink
      })
    } else {
      copyLink()
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-5">
      <h1 className="text-white font-black text-2xl">Refer & Earn 👥</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#111] border border-gray-700 rounded-2xl
                        p-4 text-center">
          <Users size={24} className="text-green-400 mx-auto mb-2" />
          <p className="text-white font-bold text-2xl">{stats.referrals}</p>
          <p className="text-gray-400 text-sm">Friends Joined</p>
        </div>
        <div className="bg-[#111] border border-gray-700 rounded-2xl
                        p-4 text-center">
          <span className="text-2xl">🪙</span>
          <p className="text-white font-bold text-2xl mt-1">
            {stats.earned}
          </p>
          <p className="text-gray-400 text-sm">Coins Earned</p>
        </div>
      </div>

      {/* Referral Link */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <p className="text-gray-400 text-sm mb-3">Your Referral Link</p>
        <div className="bg-[#1a1a1a] rounded-xl p-3 flex items-center
                        gap-3 mb-4">
          <span className="text-green-400 text-sm font-mono truncate flex-1">
            {referralLink}
          </span>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={copyLink}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <Copy size={16} />
          </motion.button>
        </div>

        {copied && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-green-400 text-sm text-center mb-3"
          >
            ✅ Link copied!
          </motion.p>
        )}

        <button
          onClick={shareLink}
          className="w-full bg-green-500 text-black font-bold py-3
                     rounded-xl flex items-center justify-center gap-2
                     hover:bg-green-400 transition-colors"
        >
          <Share2 size={18} />
          Share with Friends
        </button>
      </div>

      {/* How it works */}
      <div className="bg-[#111] border border-gray-700 rounded-2xl p-5">
        <h3 className="text-white font-bold mb-4">How it works</h3>
        <div className="space-y-3">
          {[
            ['1', 'Share your unique referral link'],
            ['2', 'Friend signs up and plays'],
            ['3', 'You both earn bonus coins!']
          ].map(([num, text]) => (
            <div key={num} className="flex items-center gap-3">
              <div className="w-7 h-7 bg-green-500/20 border
                              border-green-500/30 rounded-full flex
                              items-center justify-center text-green-400
                              font-bold text-sm">
                {num}
              </div>
              <span className="text-gray-300 text-sm">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}