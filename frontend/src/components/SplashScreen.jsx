import { motion } from 'framer-motion'
import { useEffect } from 'react'

export default function SplashScreen({ onFinish }) {
  useEffect(() => {
    const t = setTimeout(onFinish, 3000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col
                    items-center justify-center z-50">
      {/* Glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2
                        -translate-y-1/2 w-96 h-96 bg-green-500/10
                        rounded-full blur-3xl animate-pulse" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="flex flex-col items-center relative z-10"
      >
        {/* Logo */}
        <div className="flex items-baseline gap-3 mb-4">
          <motion.span
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-white font-black text-6xl md:text-8xl
                       tracking-tight"
            style={{ textShadow: '0 0 40px rgba(255,255,255,0.3)' }}
          >
            LISA
          </motion.span>
          <motion.span
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="text-green-400 font-black text-6xl md:text-8xl
                       tracking-tight"
            style={{ textShadow: '0 0 40px rgba(74,222,128,0.5)' }}
          >
            SWEEPS
          </motion.span>
        </div>

        {/* Slogan */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.8 }}
          className="text-gray-400 text-lg md:text-xl
                     tracking-[0.3em] uppercase"
        >
          A World of Winners
        </motion.p>

        {/* Loading bar */}
        <motion.div
          className="mt-12 w-48 h-1 bg-gray-800 rounded-full overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <motion.div
            className="h-full bg-green-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ delay: 1.3, duration: 1.5, ease: 'easeInOut' }}
          />
        </motion.div>
      </motion.div>
    </div>
  )
}