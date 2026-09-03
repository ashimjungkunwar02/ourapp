import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence }                  from 'framer-motion'
import { Volume2, VolumeX }                         from 'lucide-react'
import { buildFullWheel }                           from '../utils/wheelConfig'
import { soundEngine }                              from '../utils/soundEngine'
import { haptics }                                  from '../utils/haptics'
import axios                                        from 'axios'

const SEGMENTS = buildFullWheel()
const TOTAL    = SEGMENTS.length
const ARC      = (2 * Math.PI) / TOTAL

export default function SpinWheel({ coins, onCoinsUpdate }) {
  const canvasRef               = useRef(null)
  const rotationRef             = useRef(0)
  const animRef                 = useRef(null)
  const [spinning, setSpinning] = useState(false)
  const [result,   setResult]   = useState(null)
  const [soundOn,  setSoundOn]  = useState(true)

  useEffect(() => {
    drawWheel(0)
  }, [])

  const drawWheel = useCallback((rot) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx    = canvas.getContext('2d')
    const W      = canvas.width
    const cx     = W / 2
    const cy     = W / 2
    const radius = cx - 8

    ctx.clearRect(0, 0, W, W)

    SEGMENTS.forEach((seg, i) => {
      const startAngle = rot + i * ARC - Math.PI / 2
      const endAngle   = startAngle + ARC

      // Segment
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, radius, startAngle, endAngle)
      ctx.closePath()
      ctx.fillStyle   = seg.color
      ctx.fill()
      ctx.strokeStyle = '#0a0a0a'
      ctx.lineWidth   = 2
      ctx.stroke()

      // Label
      const midAngle = startAngle + ARC / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(midAngle)
      ctx.textAlign    = 'right'
      ctx.fillStyle    = '#ffffff'
      ctx.font         = `bold 10px Arial, sans-serif`
      ctx.shadowColor  = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur   = 4
      ctx.fillText(seg.label, radius - 8, 4)
      ctx.restore()
    })

    // Outer ring
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
    ctx.strokeStyle = '#374151'
    ctx.lineWidth   = 4
    ctx.stroke()

    // Center circle
    ctx.beginPath()
    ctx.arc(cx, cy, 32, 0, 2 * Math.PI)
    ctx.fillStyle   = '#0a0a0a'
    ctx.fill()
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth   = 2
    ctx.stroke()

    // Center text
    ctx.fillStyle    = '#22c55e'
    ctx.font         = 'bold 8px Arial'
    ctx.textAlign    = 'center'
    ctx.shadowBlur   = 0
    ctx.fillText('LISA',   cx, cy - 3)
    ctx.fillText('SWEEPS', cx, cy + 8)
  }, [])

  const handleSpin = async () => {
    if (spinning || coins < 1) return
    soundEngine.resume()
    setSpinning(true)
    setResult(null)
    haptics.medium()

    try {
      const res     = await axios.post('/game/spin')
      const outcome = res.data.result
      onCoinsUpdate(res.data.newBalance)

      const segIdx        = SEGMENTS.findIndex(s => s.id === outcome.id)
      const segAngle      = segIdx * ARC
      const fullRotations = (5 + Math.floor(Math.random() * 4)) * 2 * Math.PI
      const targetRot     = fullRotations + (2 * Math.PI - segAngle)

      const startRot  = rotationRef.current
      const endRot    = startRot + targetRot
      const duration  = 5500
      const startTime = performance.now()

      const animate = (now) => {
        const elapsed  = now - startTime
        const progress = Math.min(elapsed / duration, 1)
        const eased    = 1 - Math.pow(1 - progress, 4)
        const current  = startRot + (endRot - startRot) * eased

        rotationRef.current = current
        drawWheel(current)

        // Tick sound
        if (progress < 0.8) {
          const tickChance = progress < 0.5 ? 0.3 : 0.15
          if (Math.random() < tickChance) {
            soundEngine.tick(false)
            haptics.tick()
          }
        }

        if (progress < 1) {
          animRef.current = requestAnimationFrame(animate)
        } else {
          soundEngine.wheelStop()
          if (outcome.type === 'cash') {
            soundEngine.fanfare()
            haptics.bigWin()
          } else {
            soundEngine.smallWin()
            haptics.medium()
          }
          setSpinning(false)
          setResult({ ...outcome, newBalance: res.data.newBalance })
        }
      }

      animRef.current = requestAnimationFrame(animate)

    } catch (err) {
      console.error('Spin error:', err)
      setSpinning(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full">

      {/* Coins + Sound */}
      <div className="flex items-center justify-between w-full max-w-sm">
        <div className="flex items-center gap-2 bg-[#1a1a1a] border
                        border-gray-700 rounded-full px-4 py-2">
          <span className="text-yellow-400">🪙</span>
          <span className="text-white font-bold">{coins}</span>
          <span className="text-gray-500 text-xs">coins</span>
        </div>

        <button
          onClick={() => {
            const on = soundEngine.toggle()
            setSoundOn(on)
          }}
          className="p-2 text-gray-500 hover:text-white transition-colors
                     bg-[#1a1a1a] border border-gray-700 rounded-full"
        >
          {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </div>

      {/* Wheel */}
      <div className="relative">
        {/* Pointer */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2
                        -translate-y-1 z-10">
          <div className="w-0 h-0 border-l-[14px] border-r-[14px]
                          border-t-[28px] border-l-transparent
                          border-r-transparent border-t-green-400
                          filter drop-shadow-lg" />
        </div>

        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          className="rounded-full border-4 border-gray-800
                     shadow-2xl shadow-black/50"
          style={{ maxWidth: '90vw', maxHeight: '90vw' }}
        />
      </div>

      {/* Spin Button */}
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={handleSpin}
        disabled={spinning || coins < 1}
        className={`w-full max-w-sm py-4 rounded-2xl font-black
                    text-lg uppercase tracking-widest transition-all
                    ${coins < 1
                      ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                      : spinning
                      ? 'bg-[#1a1a1a] text-green-400 border border-green-500/30'
                      : 'bg-green-500 text-black shadow-lg shadow-green-500/30'
                    }`}
      >
        {spinning ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-green-400/30
                            border-t-green-400 rounded-full animate-spin" />
            Spinning...
          </div>
        ) : coins < 1 ? (
          'No Coins — Wait for Timer'
        ) : (
          'SPIN  (−1 🪙)'
        )}
      </motion.button>

      {/* Result Modal */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center
                       z-50 p-4"
          >
            <div
              className="absolute inset-0 bg-black/75 backdrop-blur-md"
              onClick={() => setResult(null)}
            />

            <motion.div
              initial={{ scale: 0.5, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.5, y: 50 }}
              transition={{ type: 'spring', bounce: 0.4 }}
              className="relative bg-[#0f0f0f] border border-gray-700
                         rounded-3xl p-8 text-center max-w-sm w-full
                         shadow-2xl overflow-hidden"
            >
              {/* Glow */}
              <div className={`absolute inset-0 opacity-10 rounded-3xl
                ${result.type === 'cash'
                  ? 'bg-yellow-400'
                  : 'bg-green-400'}`}
              />

              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: 2, duration: 0.4 }}
                className="text-7xl mb-4 relative z-10"
              >
                {result.type === 'cash' ? '💰' : '🎉'}
              </motion.div>

              <p className="text-gray-400 text-sm uppercase tracking-widest
                            mb-1 relative z-10">
                Congratulations!
              </p>

              <h2 className="text-white font-black text-3xl mb-3
                             relative z-10">
                You Won!
              </h2>

              <div className={`font-black text-5xl mb-4 relative z-10
                ${result.type === 'cash'
                  ? 'text-yellow-400'
                  : 'text-green-400'}`}>
                {result.label}
              </div>

              {result.type === 'cash' ? (
                <p className="text-gray-300 text-sm relative z-10">
                  🎊 <strong className="text-yellow-400">
                    ${result.value} Free Play
                  </strong> credited to your account!
                </p>
              ) : (
                <p className="text-gray-300 text-sm relative z-10">
                  Your <strong className="text-green-400">
                    {result.value}% bonus
                  </strong> has been activated!
                </p>
              )}

              <p className="text-gray-500 text-xs mt-2 relative z-10">
                You have{' '}
                <span className="text-yellow-400 font-bold">
                  {result.newBalance} coins
                </span>{' '}
                remaining
              </p>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setResult(null)}
                className="mt-6 w-full bg-green-500 text-black font-black
                           py-3.5 rounded-xl hover:bg-green-400
                           transition-colors text-lg relative z-10"
              >
                Let's Go! 🚀
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}