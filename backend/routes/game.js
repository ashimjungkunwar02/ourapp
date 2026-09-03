const router          = require('express').Router()
const User            = require('../models/User')
const Activity        = require('../models/Activity')
const Notification    = require('../models/Notification')
const { protect }     = require('../middleware/authMiddleware')
const { spinWheel }   = require('../utils/wheelLogic')

// GET /api/game/coin-status
router.get('/coin-status', protect, async (req, res) => {
  try {
    const user = req.user

    if (!user.lastClaim) {
      return res.json({ canClaim: true, secondsLeft: 0 })
    }

    const now       = Date.now()
    const elapsed   = now - new Date(user.lastClaim).getTime()
    const oneHour   = 3600 * 1000

    if (elapsed >= oneHour) {
      return res.json({ canClaim: true, secondsLeft: 0 })
    }

    const secondsLeft = Math.ceil((oneHour - elapsed) / 1000)
    res.json({ canClaim: false, secondsLeft })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/game/claim-coin
router.post('/claim-coin', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    const now  = new Date()

    // Check if already claimed within the hour
    if (user.lastClaim) {
      const elapsed = now - new Date(user.lastClaim)
      if (elapsed < 3600 * 1000) {
        return res.status(400).json({ message: 'Coin not ready yet' })
      }
    }

    // Streak logic
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    const yesterdayStart = new Date(todayStart)
    yesterdayStart.setDate(yesterdayStart.getDate() - 1)

    let coinsToAdd   = 1
    let bonusApplied = null

    if (user.lastStreakDate) {
      const lastDate = new Date(user.lastStreakDate)
      lastDate.setHours(0, 0, 0, 0)

      if (lastDate.getTime() === yesterdayStart.getTime()) {
        // Continued streak
        user.streak += 1
      } else if (lastDate.getTime() === todayStart.getTime()) {
        // Already claimed today — maintain streak
      } else {
        // Streak broken
        user.streak = 1
      }
    } else {
      user.streak = 1
    }

    // 7-day streak reward
    if (user.streak > 0 && user.streak % 7 === 0) {
      coinsToAdd   = 3
      bonusApplied = 69
      user.bonusBalance += 69
    }

    user.coins         += coinsToAdd
    user.lastClaim      = now
    user.lastStreakDate  = now
    await user.save()

    await Activity.create({
      userId:      user._id,
      username:    user.username,
      type:        'claim',
      description: `claimed ${coinsToAdd} coin${coinsToAdd > 1 ? 's' : ''}${
        bonusApplied ? ` + ${bonusApplied}% streak bonus` : ''
      }`
    })

    res.json({
      newBalance:   user.coins,
      streak:       user.streak,
      bonusApplied,
      coinsAdded:   coinsToAdd
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/game/spin
router.post('/spin', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    // Check coins (admin has unlimited)
    if (!user.isAdmin && user.coins < 1) {
      return res.status(400).json({ message: 'Not enough coins to spin' })
    }

    // Deduct 1 coin (not for admin)
    if (!user.isAdmin) {
      user.coins -= 1
    }

    // Get result from server-side wheel
    const result = spinWheel()

    // Apply result
    user.totalSpins += 1
    if (result.type === 'cash') {
      user.bonusBalance += result.value
    } else if (result.type === 'bonus') {
      user.bonusBalance += result.value
    }

    await user.save()

    // Log activity
    await Activity.create({
      userId:      user._id,
      username:    user.username,
      type:        result.type === 'cash' ? 'win' : 'spin',
      description: result.type === 'cash'
        ? `won ${result.label} on the wheel!`
        : `spun the wheel and got ${result.label}`
    })

    res.json({
      result,
      newBalance:   user.coins,
      bonusBalance: user.bonusBalance
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/game/notifications
router.get('/notifications', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
    res.json(notifications)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/game/notifications/:id/read
router.post('/notifications/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router