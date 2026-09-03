const mongoose       = require('mongoose')
const router         = require('express').Router()
const User           = require('../models/User')
const Activity       = require('../models/Activity')
const Notification   = require('../models/Notification')
const BonusProgram   = require('../models/BonusProgram')
const { protect, adminOnly }       = require('../middleware/authMiddleware')
const { adminMutationLimiter }     = require('../middleware/rateLimiters')

// All admin routes require login + admin role
router.use(protect, adminOnly)

const DAY_MS = 24 * 3600 * 1000

// ── Validation helpers ──────────────────────────────────────────────────────
// Every one of these exists because the previous code coerced request bodies
// with Number()/arithmetic and then trusted the result. `Number(undefined)` is
// NaN, and `NaN < 1` / `NaN > 100` are BOTH false — so a range check written as
// `if (amount < 1 || amount > 100)` happily lets NaN through and writes it to
// the database, permanently corrupting a user's balance.
const toFiniteNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const isPositiveInt = (value, max = Number.MAX_SAFE_INTEGER) => {
  const n = toFiniteNumber(value)
  return n !== null && Number.isInteger(n) && n > 0 && n <= max
}

const validId = (id) => mongoose.isValidObjectId(id)

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, activeToday, spinsArr] = await Promise.all([
      User.countDocuments({ isAdmin: false }),
      User.countDocuments({
        isAdmin:   false,
        lastLogin: { $gte: new Date(Date.now() - DAY_MS) }
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
router.post('/users/create', adminMutationLimiter, async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' })
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Username and password must be strings' })
    }
    if (username.trim().length < 3 || username.trim().length > 24) {
      return res.status(400).json({ message: 'Username must be 3-24 characters' })
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' })
    }

    const normalizedName = username.trim().toLowerCase()

    const existing = await User.findOne({ username: normalizedName })
    if (existing) {
      return res.status(400).json({ message: 'Username already taken' })
    }

    // The User schema hashes on `save` via a pre-hook, so pass the plaintext
    // password here — hashing it first would double-hash and lock the account.
    const user = await User.create({
      username: normalizedName,
      password,
      coins:    0
    })

    try {
      await Activity.create({
        userId:      req.user._id,
        username:    req.user.username,
        type:        'admin',
        description: `created new user account: ${user.username}`
      })
    } catch (logErr) {
      console.log('Activity log error:', logErr.message)
    }

    res.json({
      message: 'User created successfully',
      user: {
        _id:      user._id,
        username: user.username,
        coins:    user.coins
      }
    })
  } catch (err) {
    // Surface duplicate-key races (E11000) as a clean 400 rather than a 500.
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Username already taken' })
    }
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/users/:id/points
//
// VALIDATION + ATOMICITY FIX: `amount` is now required to be a finite positive
// integer, `type` must be exactly 'add' or 'deduct', and the balance is mutated
// with a single atomic update instead of read-modify-write (which let two
// concurrent adjustments lose one of them).
router.post('/users/:id/points', adminMutationLimiter, async (req, res) => {
  try {
    const { amount, type } = req.body

    if (!validId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' })
    }

    if (amount === undefined || amount === null || type === undefined || type === null) {
      return res.status(400).json({ message: 'Amount and type required' })
    }

    if (type !== 'add' && type !== 'deduct') {
      return res.status(400).json({ message: 'Type must be add or deduct' })
    }

    const amountNum = toFiniteNumber(amount)
    if (amountNum === null) {
      return res.status(400).json({ message: 'Amount must be a finite number' })
    }
    if (amountNum <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' })
    }
    if (!Number.isInteger(amountNum)) {
      return res.status(400).json({ message: 'Amount must be a whole number of coins' })
    }
    // Guard against absurd values overflowing the balance.
    if (amountNum > 1_000_000) {
      return res.status(400).json({ message: 'Amount must not exceed 1,000,000' })
    }

    let updated

    if (type === 'add') {
      updated = await User.findOneAndUpdate(
        { _id: req.params.id },
        { $inc: { coins: amountNum } },
        { new: true }
      )
    } else {
      // Clamp at zero inside the update via an aggregation pipeline. Doing this
      // as `$inc: -amount` could drive the balance negative; doing it in JS
      // (Math.max) reintroduces the read-modify-write race.
      updated = await User.findOneAndUpdate(
        { _id: req.params.id },
        [{ $set: { coins: { $max: [0, { $subtract: ['$coins', amountNum] }] } } }],
        { new: true }
      )
    }

    if (!updated) {
      return res.status(404).json({ message: 'User not found' })
    }

    try {
      await Activity.create({
        userId:      req.user._id,
        username:    req.user.username,
        type:        'admin',
        description: `${type === 'add' ? 'added' : 'deducted'} ${amountNum} coins ${
          type === 'add' ? 'to' : 'from'
        } ${updated.username}`,
        metadata: { action: 'points', type, amount: amountNum, targetUser: String(updated._id) }
      })
    } catch (logErr) {
      console.log('Activity log error:', logErr.message)
    }

    res.json({ newBalance: updated.coins })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', adminMutationLimiter, async (req, res) => {
  try {
    const { password } = req.body

    if (!validId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user id' })
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ message: 'New password required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    // Assigning triggers the schema's pre('save') hash hook.
    user.password = password
    await user.save()

    try {
      await Activity.create({
        userId:      req.user._id,
        username:    req.user.username,
        type:        'admin',
        description: `reset password for user: ${user.username}`
      })
    } catch (logErr) {
      console.log('Activity log error:', logErr.message)
    }

    res.json({ message: 'Password reset successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/bonus/launch
//
// VALIDATION FIX: the BonusProgram schema requires `message`, but the route
// never validated or defaulted it — launching without copy threw a Mongoose
// ValidationError and returned a raw 500. The message is now derived when
// omitted, and type/percentage/validHours are all validated up front.
router.post('/bonus/launch', adminMutationLimiter, async (req, res) => {
  try {
    const { type, percentage, validHours } = req.body
    const rawMessage = req.body.message

    if (!type || !['deposit', 'referral'].includes(type)) {
      return res.status(400).json({ message: "Type must be 'deposit' or 'referral'" })
    }

    const percentageNum = toFiniteNumber(percentage)
    if (percentageNum === null || percentageNum < 1 || percentageNum > 500) {
      return res.status(400).json({ message: 'Percentage must be a number between 1 and 500' })
    }

    const validHoursNum = toFiniteNumber(validHours)
    if (validHoursNum === null || validHoursNum <= 0 || validHoursNum > 24 * 365) {
      return res.status(400).json({ message: 'validHours must be a positive number of hours' })
    }

    if (rawMessage !== undefined && typeof rawMessage !== 'string') {
      return res.status(400).json({ message: 'Message must be a string' })
    }

    // Derive default copy when the admin leaves the message blank, so the value
    // written to the DB is always a non-empty string.
    const finalMessage = (rawMessage && rawMessage.trim())
      ? rawMessage.trim()
      : `${percentageNum}% ${type} bonus is live! Valid for ${validHoursNum} hours only!`

    const expiresAt = new Date(Date.now() + validHoursNum * 3600 * 1000)

    const bonus = await BonusProgram.create({
      type,
      percentage: percentageNum,
      validHours:  validHoursNum,
      expiresAt,
      message:    finalMessage,
      createdBy:  req.user._id
    })

    // Notify all non-admin users
    const users = await User.find({ isAdmin: false }).select('_id')

    if (users.length > 0) {
      const notifications = users.map(u => ({
        userId:  u._id,
        title:   `\uD83C\uDF81 ${percentageNum}% ${type === 'deposit' ? 'Deposit' : 'Referral'} Bonus Activated!`,
        message: finalMessage,
        type:    'bonus'
      }))

      try {
        // ordered:false keeps going if an individual doc fails, so one bad
        // userId can't abort the whole fan-out.
        await Notification.insertMany(notifications, { ordered: false })
      } catch (notifyErr) {
        console.error('Bonus notification fan-out error:', notifyErr.message)
      }

      await BonusProgram.updateOne(
        { _id: bonus._id },
        { $set: { usersNotified: users.length } }
      )
    }

    // Real-time push to all connected clients
    req.io?.emit('bonus_notification', {
      type,
      percentage: percentageNum,
      validHours:  validHoursNum,
      message:    finalMessage,
      expiresAt
    })

    try {
      await Activity.create({
        userId:      req.user._id,
        username:    req.user.username,
        type:        'bonus',
        description: `launched ${percentageNum}% ${type} bonus valid for ${validHoursNum} hours`
      })
    } catch (logErr) {
      console.log('Activity log error:', logErr.message)
    }

    res.json({
      message:       'Bonus launched successfully',
      notifiedUsers: users.length
    })
  } catch (err) {
    console.error('bonus/launch error:', err.message)
    res.status(500).json({ message: 'Failed to launch bonus' })
  }
})

// POST /api/admin/rain
//
// VALIDATION FIX: `const { amount = 5 } = req.body` only defaults when the key
// is ABSENT. Sending `{ amount: "abc" }` yields NaN, and `NaN < 1 || NaN > 100`
// is false — so NaN passed the range check and `$inc` corrupted every user's
// coin balance. amount is now parsed and rejected unless it is a valid integer.
router.post('/rain', adminMutationLimiter, async (req, res) => {
  try {
    const rawAmount = req.body?.amount ?? 5
    const amount    = toFiniteNumber(rawAmount)

    if (amount === null) {
      return res.status(400).json({ message: 'Amount must be a number' })
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return res.status(400).json({ message: 'Amount must be a whole number between 1 and 100' })
    }

    // Add coins to all non-admin users (single atomic bulk update)
    const result = await User.updateMany(
      { isAdmin: false },
      { $inc: { coins: amount } }
    )

    const users = await User.find({ isAdmin: false }).select('_id')

    if (users.length > 0) {
      const notifications = users.map(u => ({
        userId:  u._id,
        title:   "\uD83C\uDF27\uFE0F It's Raining Coins!",
        message: `Admin made it rain! You received ${amount} free coin${
          amount > 1 ? 's' : ''
        } instantly!`,
        // 'rain' is a valid enum member on both Notification and Activity now.
        type: 'rain'
      }))

      try {
        await Notification.insertMany(notifications, { ordered: false })
      } catch (notifyErr) {
        // Coins are already distributed; never roll that back over a
        // notification write. Log and continue.
        console.error('Rain notification fan-out error:', notifyErr.message)
      }
    }

    // Broadcast to all connected clients in real time
    req.io?.emit('rain_event', { amount })

    try {
      await Activity.create({
        userId:      req.user._id,
        username:    req.user.username,
        type:        'rain',
        description: `made it rain — distributed ${amount} coins to ${result.modifiedCount} users`,
        metadata:    { action: 'rain', amount, usersAffected: result.modifiedCount }
      })
    } catch (logErr) {
      console.log('Activity log error:', logErr.message)
    }

    res.json({
      message:      'Rain started successfully',
      usersAffected: result.modifiedCount,
      coinsGiven:   amount
    })
  } catch (err) {
    console.error('rain error:', err.message)
    res.status(500).json({ message: 'Failed to start rain' })
  }
})

// GET /api/admin/activities
router.get('/activities', async (req, res) => {
  try {
    const limit = Math.min(Math.max(toFiniteNumber(req.query.limit) || 20, 1), 100)
    const activities = await Activity.find()
      .sort({ createdAt: -1 })
      .limit(limit)
    res.json(activities)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/admin/metrics
//
// CHART-RANGE FIX: buildChart always looped 7 times regardless of `days`, so
// range=30d and range=all returned 7 buckets while `since` filtered a much
// wider window — silently discarding most of the data. It now loops `days`.
//
// MOCK-DATA FIX: userGrowth / activeGrowth / spinGrowth / fpGrowth / bonusRate /
// retentionRate / totalFPPaid were hardcoded constants (5, 12, 8, 3, 85, 72) or
// naive multiples of a win count. They are now computed from the database, and
// anything that cannot be measured exactly is reported in `estimated` so the UI
// can label it honestly.
router.get('/metrics', async (req, res) => {
  try {
    const { range = '7d' } = req.query
    const days  = range === '30d' ? 30 : range === 'all' ? 90 : 7
    const now   = Date.now()
    const since = new Date(now - days * DAY_MS)
    // Matching-length window immediately before `since`, for growth deltas.
    const prevSince = new Date(since.getTime() - days * DAY_MS)

    const buildChart = async (matchStage) => {
      const result = await Activity.aggregate([
        { $match: { ...matchStage, createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])

      const byDay = new Map(result.map(r => [r._id, r.count]))

      const chartData = []
      // Loop the requested range, not a hardcoded 7.
      for (let i = days - 1; i >= 0; i--) {
        const d   = new Date(now - i * DAY_MS)
        const key = d.toISOString().split('T')[0]
        chartData.push({ date: key, value: byDay.get(key) || 0 })
      }
      return chartData
    }

    const countInRange = (model, filter, from, to) =>
      model.countDocuments(to ? { ...filter, createdAt: { $gte: from, $lt: to } }
                            : { ...filter, createdAt: { $gte: from } })

    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))

    const [
      totalUsers,
      activeToday,
      spinsArr,
      winsTotal,
      dauChart,
      spinsChart,
      bonusChart,
      onlineCount,
      spinsToday,
      coinsClaimedToday,
      // current vs previous window
      usersThisWindow,
      usersPrevWindow,
      activeThisWindow,
      activePrevWindow,
      spinsThisWindow,
      spinsPrevWindow,
      winsThisWindow,
      winsPrevWindow,
      // outcome mix for bonusRate
      bonusOutcomeCount,
      cashOutcomeCount,
      // real FP payout total from recorded outcome values
      fpPaidAgg,
      fpTodayAgg,
      // retention cohort
      cohortSize,
      cohortReturned
    ] = await Promise.all([
      User.countDocuments({ isAdmin: false }),
      User.countDocuments({ isAdmin: false, lastLogin: { $gte: new Date(now - DAY_MS) } }),
      User.aggregate([{ $group: { _id: null, t: { $sum: '$totalSpins' } } }]),
      Activity.countDocuments({ type: 'win' }),
      buildChart({ type: { $in: ['login', 'spin', 'claim'] } }),
      buildChart({ type: { $in: ['spin', 'win'] } }),
      buildChart({ type: 'bonus' }),
      User.countDocuments({ isAdmin: false, lastLogin: { $gte: new Date(now - 5 * 60 * 1000) } }),
      Activity.countDocuments({ type: { $in: ['spin', 'win'] }, createdAt: { $gte: todayStart } }),
      Activity.countDocuments({ type: 'claim', createdAt: { $gte: todayStart } }),

      countInRange(User, { isAdmin: false }, since, null),
      countInRange(User, { isAdmin: false }, prevSince, since),
      countInRange(Activity, { type: { $in: ['login', 'spin', 'claim'] } }, since, null),
      countInRange(Activity, { type: { $in: ['login', 'spin', 'claim'] } }, prevSince, since),
      countInRange(Activity, { type: { $in: ['spin', 'win'] } }, since, null),
      countInRange(Activity, { type: { $in: ['spin', 'win'] } }, prevSince, since),
      countInRange(Activity, { type: 'win' }, since, null),
      countInRange(Activity, { type: 'win' }, prevSince, since),

      countInRange(Activity, { type: 'spin' }, since, null),
      countInRange(Activity, { type: 'win'  }, since, null),

      // Sum the REAL recorded cash values. Only spins logged after the
      // metadata change carry a value, so coverage is reported below.
      Activity.aggregate([
        { $match: { type: 'win', 'metadata.value': { $exists: true } } },
        { $group: { _id: null, total: { $sum: '$metadata.value' }, n: { $sum: 1 } } }
      ]),
      Activity.aggregate([
        { $match: { type: 'win', createdAt: { $gte: todayStart }, 'metadata.value': { $exists: true } } },
        { $group: { _id: null, total: { $sum: '$metadata.value' }, n: { $sum: 1 } } }
      ]),

      // Retention: of users old enough to have churned (created >7d ago),
      // how many logged in during the last 7 days?
      User.countDocuments({ isAdmin: false, createdAt: { $lt: new Date(now - 7 * DAY_MS) } }),
      User.countDocuments({
        isAdmin:   false,
        createdAt: { $lt: new Date(now - 7 * DAY_MS) },
        lastLogin: { $gte: new Date(now - 7 * DAY_MS) }
      })
    ])

    const totalSpins = spinsArr[0]?.t || 0

    // Percentage change between two windows; null when there is no baseline.
    const growthPct = (current, previous) => {
      if (!previous) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 1000) / 10
    }

    const totalOutcomes  = bonusOutcomeCount + cashOutcomeCount
    const fpPaidMeasured = fpPaidAgg[0]?.total || 0
    const fpWinsMeasured = fpPaidAgg[0]?.n || 0

    // Wins logged before metadata existed have no recorded value, so the true
    // lifetime payout is AT LEAST the measured figure. Report the gap rather
    // than pretending a $3 average.
    const winsWithoutValue = Math.max(0, winsTotal - fpWinsMeasured)

    const metrics = {
      // ── Measured directly ───────────────────────────────────────────────
      totalUsers,
      activeToday,
      totalSpins,
      onlineNow:         onlineCount,
      spinsToday,
      coinsClaimedToday,
      fpPayoutRate:      totalSpins > 0
        ? Math.round((winsTotal / totalSpins) * 1000) / 10
        : 0,
      bonusRate:         totalOutcomes > 0
        ? Math.round((bonusOutcomeCount / totalOutcomes) * 1000) / 10
        : 0,
      retentionRate:     cohortSize > 0
        ? Math.round((cohortReturned / cohortSize) * 1000) / 10
        : 0,

      // ── Computed period-over-period ─────────────────────────────────────
      userGrowth:   growthPct(usersThisWindow,  usersPrevWindow),
      activeGrowth: growthPct(activeThisWindow, activePrevWindow),
      spinGrowth:   growthPct(spinsThisWindow,  spinsPrevWindow),
      fpGrowth:     growthPct(winsThisWindow,   winsPrevWindow),

      // ── Payouts ─────────────────────────────────────────────────────────
      totalFPPaid: fpPaidMeasured,
      fpToday:     fpTodayAgg[0]?.total || 0,

      dauChart,
      spinsChart,
      bonusChart,
      fpChart: spinsChart.map(d => ({ ...d, value: 0 }))
    }

    // Honest provenance so the UI can flag anything not measured exactly.
    metrics.meta = {
      range,
      days,
      generatedAt: new Date().toISOString(),
      estimated: [
        ...(winsWithoutValue > 0
          ? [`totalFPPaid excludes ${winsWithoutValue} win(s) logged before outcome values were recorded`]
          : []),
        // fpChart needs a real FP-per-day series; the old code faked it as
        // spins * 0.4 * 3. Zeroed out rather than left misleading.
        'fpChart is not yet backed by a per-day FP series'
      ]
    }

    res.json(metrics)
  } catch (err) {
    console.error('metrics error:', err.message)
    res.status(500).json({ message: 'Failed to compute metrics' })
  }
})

module.exports = router
