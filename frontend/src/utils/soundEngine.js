class SoundEngine {
  constructor() {
    this.ctx     = null
    this.enabled = true
  }

  init() {
    if (this.ctx) return
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    } catch {
      console.warn('Web Audio not supported')
    }
  }

  resume() {
    this.init()
    if (this.ctx?.state === 'suspended') this.ctx.resume()
  }

  toggle() {
    this.enabled = !this.enabled
    return this.enabled
  }

  playTone(freq = 440, duration = 0.08, volume = 0.3, type = 'sine') {
    if (!this.enabled || !this.ctx) return
    try {
      const osc  = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.frequency.value = freq
      osc.type            = type
      gain.gain.setValueAtTime(volume, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.ctx.currentTime + duration
      )
      osc.start(this.ctx.currentTime)
      osc.stop(this.ctx.currentTime + duration)
    } catch {}
  }

  tick(nearBigPrize = false) {
    if (!this.enabled || !this.ctx) return
    const freq = nearBigPrize ? 900 : 200 + Math.random() * 100
    this.playTone(freq, 0.04, nearBigPrize ? 0.4 : 0.2, 'square')
  }

  tensionTick() {
    if (!this.enabled || !this.ctx) return
    this.playTone(750, 0.06, 0.35, 'sawtooth')
  }

  fanfare() {
    if (!this.enabled || !this.ctx) return
    const notes = [523, 659, 784, 1047]
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.3, 0.5, 'sine'), i * 150)
    })
  }

  smallWin() {
    if (!this.enabled || !this.ctx) return
    this.playTone(660, 0.15, 0.3)
    setTimeout(() => this.playTone(880, 0.15, 0.3), 150)
  }

  coinClaim() {
    if (!this.enabled || !this.ctx) return
    ;[880, 1100, 1320].forEach((f, i) =>
      setTimeout(() => this.playTone(f, 0.1, 0.25), i * 80)
    )
  }

  rainSound() {
    if (!this.enabled || !this.ctx) return
    for (let i = 0; i < 8; i++) {
      setTimeout(() => this.playTone(
        400 + Math.random() * 800, 0.1, 0.15
      ), i * 60)
    }
  }

  wheelStop() {
    if (!this.enabled || !this.ctx) return
    this.playTone(80, 0.3, 0.5, 'sine')
    setTimeout(() => this.playTone(60, 0.2, 0.3, 'sine'), 100)
  }
}

export const soundEngine = new SoundEngine()