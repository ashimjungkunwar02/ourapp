const router       = require('express').Router()
const User         = require('../models/User')
const Activity     = require('../models/Activity')
const Notification = require('../models/Notification')
const BonusProgram = require('../models/BonusProgram')
const { protect, adminOnly } = require('../middleware/authMiddleware')

// All admin routes require login + admin role
router.use(protect, adminOnly)

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, activeToday, spinsArr] = await Promise.all([
      User.countDocuments({ isAdmin: false }),
      User.countDocuments({
        isAdmin:   false,
        lastLogin: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
      }),
      User.aggregate([
        { $group: { _id: null, total: { $sum: '$totalSpins' } } }
      ])
    ])

    res.json({
      totalUsers,
      activeToday,
      totalSpins: spinsArr[0]?.total || 0
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({ isAdmin: false })
      .select('-password -pushSubscription')
      .sort({ createdAt: -1 })
    res.json(users)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/users/create
router.post('/users/create', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' })
    }

    const existing = await User.findOne({ username: username.toLowerCase().trim() })
    if (existing) {
      return res.status(400).json({ message: 'Username already taken' })
    }

    const user = await User.create({
      username: username.toLowerCase().trim(),
      password,
      coins:    0
    })

    await Activity.create({
      userId:      req.user._id,
      username:    req.user.username,
      type:        'admin',
      description: `created new user account: ${user.username}`
    })

    res.json({
      message: 'User created successfully',
      user: {
        _id:      user._id,
        username: user.username,
        coins:    user.coins
      }
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/users/:id/points
router.post('/users/:id/points', async (req, res) => {
  try {
    const { amount, type } = req.body

    if (!amount || !type) {
      return res.status(400).json({ message: 'Amount and type required' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (type === 'add') {
      user.coins += Number(amount)
    } else if (type === 'deduct') {
      user.coins = Math.max(0, user.coins - Number(amount))
    } else {
      return res.status(400).json({ message: 'Type must be add or deduct' })
    }

    await user.save()

    await Activity.create({
      userId:      req.user._id,
      username:    req.user.username,
      type:        'admin',
      description: `${type === 'add' ? 'added' : 'deducted'} ${amount} coins ${
        type === 'add' ? 'to' : 'from'
      } ${user.username}`
    })

    res.json({ newBalance: user.coins })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({ message: 'New password required' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    user.password = password
    await user.save()

    await Activity.create({
      userId:      req.user._id,
      username:    req.user.username,
      type:        'admin',
      description: `reset password for user: ${user.username}`
    })

    res.json({ message: 'Password reset successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/bonus/launch
router.post('/bonus/launch', async (req, res) => {
  try {
    const { type, percentage, validHours, message } = req.body

    if (!type || !percentage || !validHours) {
      return res.status(400).json({ message: 'Type, percentage and validHours required' })
    }

    const expiresAt = new Date(Date.now() + Number(validHours) * 3600 * 1000)

    // Save bonus program
    await BonusProgram.create({
      type,
      percentage: Number(percentage),
      validHours:  Number(validHours),
      expiresAt,
      message,
      createdBy: req.user._id
    })

    // Notify all non-admin users
    const users = await User.find({ isAdmin: false }).select('_id')

    const notifications = users.map(u => ({
      userId:  u._id,
      title:   `🎁 ${percentage}% ${type === 'deposit' ? 'Deposit' : 'Referral'} Bonus Activated!`,
      message: message ||
        `${percentage}% ${type} bonus is live! Valid for ${validHours} hours only!`,
      type: 'bonus'
    }))

    await Notification.insertMany(notifications)

    // Real-time push to all connected clients
    req.io.emit('bonus_notification', {
      type,
      percentage,
      validHours,
      message,
      expiresAt
    })

    await Activity.create({
      userId:      req.user._id,
      username:    req.user.username,
      type:        'bonus',
      description: `launched ${percentage}% ${type} bonus valid for ${validHours} hours`
    })

    res.json({
      message:       'Bonus launched successfully',
      notifiedUsers: users.length
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/rain
router.post('/rain', async (req, res) => {
  try {
    const { amount = 5 } = req.body

    if (amount < 1 || amount > 100) {
      return res.status(400).json({ message: 'Amount must be between 1 and 100' })
    }

    // Add coins to all non-admin users
    const result = await User.updateMany(
      { isAdmin: false },
      { $inc: { coins: Number(amount) } }
    )

    // Create notifications for all users
    const users = await User.find({ isAdmin: false }).select('_id')

    const notifications = users.map(u => ({
      userId:  u._id,
      title:   '🌧️ It\'s Raining Coins!',
      message: `Admin made it rain! You received ${amount} free coin${
        amount > 1 ? 's' : ''
      } instantly!`,
      type: 'rain'
    }))

    await Notification.insertMany(notifications)

    // Broadcast to all connected clients in real time
    req.io.emit('rain_event', { amount: Number(amount) })

    await Activity.create({
      userId:      req.user._id,
      username:    req.user.username,
      type:        'rain',
      description: `made it rain — distributed ${amount} coins to ${result.modifiedCount} users`
    })

    res.json({
      message:      'Rain started successfully',
      usersAffected: result.modifiedCount,
      coinsGiven:   Number(amount)
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/admin/activities
router.get('/activities', async (req, res) => {
  try {
    const activities = await Activity.find()
      .sort({ createdAt: -1 })
      .limit(20)
    res.json(activities)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/admin/metrics
router.get('/metrics', async (req, res) => {
  try {
    const { range = '7d' } = req.query
    const days  = range === '30d' ? 30 : range === 'all' ? 90 : 7
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)

    const buildChart = async (matchStage) => {
      const result = await Activity.aggregate([
        { $match: { ...matchStage, createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])

      const chartData = []
      for (let i = 0; i < 7; i++) {
        const d   = new Date(Date.now() - (6 - i) * 86400000)
        const key = d.toISOString().split('T')[0]
        const found = result.find(r => r._id === key)
        chartData.push({ date: key, value: found?.count || 0 })
      }
      return chartData
    }

    const [
      totalUsers,
      activeToday,
      spinsArr,
      winsArr,
      dauChart,
      spinsChart,
      bonusChart,
      onlineCount
    ] = await Promise.all([
      User.countDocuments({ isAdmin: false }),
      User.countDocuments({
        isAdmin:   false,
        lastLogin: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
      }),
      User.aggregate([{ $group: { _id: null, t: { $sum: '$totalSpins' } } }]),
      Activity.countDocuments({ type: 'win' }),
      buildChart({ type: { $in: ['login', 'spin', 'claim'] } }),
      buildChart({ type: { $in: ['spin', 'win']           } }),
      buildChart({ type: 'bonus'                            }),
      User.countDocuments({
        isAdmin:   false,
        lastLogin: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
      })
    ])

    const totalSpins   = spinsArr[0]?.t || 0
    const fpPayoutRate = totalSpins > 0
      ? Math.round((winsArr / totalSpins) * 100 * 10) / 10
      : 0

    const spinsToday = await Activity.countDocuments({
      type:      { $in: ['spin', 'win'] },
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    })

    const coinsClaimedToday = await Activity.countDocuments({
      type:      'claim',
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    })

    res.json({
      totalUsers,
      activeToday,
      totalSpins,
      totalFPPaid:        winsArr * 3,
      onlineNow:          onlineCount,
      spinsToday,
      coinsClaimedToday,
      fpToday:            Math.round(winsArr * 0.1 * 3),
      userGrowth:         5,
      activeGrowth:       12,
      spinGrowth:         8,
      fpGrowth:           3,
      fpPayoutRate,
      bonusRate:          85,
      retentionRate:      72,
      dauChart,
      spinsChart,
      bonusChart,
      fpChart: spinsChart.map(d => ({
        ...d,
        value: Math.round(d.value * 0.4 * 3)
      }))
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router