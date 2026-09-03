import { useNavigate } from 'react-router-dom'
import { motion }      from 'framer-motion'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center
                    justify-center p-4 text-center">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <div className="text-8xl">🎡</div>

        <div>
          <h1 className="text-white font-black text-6xl mb-2">404</h1>
          <p className="text-gray-400 text-lg">
            This page spun off the wheel!
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-white font-black text-2xl">LISA</span>
          <span className="text-green-400 font-black text-2xl">SWEEPS</span>
        </div>

        <button
          onClick={() => navigate('/')}
          className="bg-green-500 text-black font-bold px-8 py-3
                     rounded-xl hover:bg-green-400 transition-colors"
        >
          Back to Home
        </button>
      </motion.div>
    </div>
  )
}