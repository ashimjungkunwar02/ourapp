const mongoose        = require('mongoose')
const router          = require('express').Router()
const User            = require('../models/User')
const Activity        = require('../models/Activity')
const Notification    = require('../models/Notification')
const { protect }     = require('../middleware/authMiddleware')
const { spinWheel }   = require('../utils/wheelLogic')

const ONE_HOUR_MS = 3600 * 1000

// GET /api/game/coin-status
router.get('/coin-status', protect, async (req, res) => {
  try {
    const user = req.user

    if (!user.lastClaim) {
      return res.json({ canClaim: true, secondsLeft: 0 })
    }

    const now     = Date.now()
    const elapsed = now - new Date(user.lastClaim).getTime()

    if (elapsed >= ONE_HOUR_MS) {
      return res.json({ canClaim: true, secondsLeft: 0 })
    }

    const secondsLeft = Math.ceil((ONE_HOUR_MS - elapsed) / 1000)
    res.json({ canClaim: false, secondsLeft })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/game/claim-coin
//
// RACE-FREE: the previous version did read-check-write
// (findById -> if elapsed >= 1h -> user.coins += 1 -> save). Two concurrent
// requests both read the stale lastClaim, both passed the check, and both
// awarded a coin. The claim window is now seized atomically: the guard lives in
// the query filter of a single findOneAndUpdate, so only one request can win.
router.post('/claim-coin', protect, async (req, res) => {
  try {
    const now        = new Date()
    const claimableFrom = new Date(now.getTime() - ONE_HOUR_MS)

    // ── Step 1: atomically seize the claim slot ─────────────────────────────
    // Returns the document as it was BEFORE the update (new: false) so we can
    // compute the streak from the pre-claim state. If another request already
    // moved lastClaim forward, this filter matches nothing and we get null.
    const pre = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        $or: [
          { lastClaim: null },
          { lastClaim: { $exists: false } },
          { lastClaim: { $lte: claimableFrom } }
        ]
      },
      { $set: { lastClaim: now } },
      { new: false }
    )

    if (!pre) {
      return res.status(400).json({ message: 'Coin not ready yet' })
    }

    // ── Step 2: compute streak from the pre-claim snapshot ──────────────────
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    const yesterdayStart = new Date(todayStart)
    yesterdayStart.setDate(yesterdayStart.getDate() - 1)

    let newStreak     = pre.streak || 0
    let streakAdvanced = false

    if (pre.lastStreakDate) {
      const lastDate = new Date(pre.lastStreakDate)
      lastDate.setHours(0, 0, 0, 0)

      if (lastDate.getTime() === yesterdayStart.getTime()) {
        newStreak      = (pre.streak || 0) + 1
        streakAdvanced = true
      } else if (lastDate.getTime() === todayStart.getTime()) {
        // Already counted today — hold the streak, do not advance it.
        streakAdvanced = false
      } else {
        // Gap of 2+ days: streak broken, restart.
        newStreak      = 1
        streakAdvanced = true
      }
    } else {
      newStreak      = 1
      streakAdvanced = true
    }

    // ── Step 3: 7-day streak reward ─────────────────────────────────────────
    // Only fire on the claim that actually ADVANCED the streak to a multiple of
    // 7. The old code tested `streak % 7 === 0` unconditionally, so on day 7
    // every hourly claim re-awarded 3 coins + 69% bonus (24x/day farming).
    let coinsToAdd   = 1
    let bonusApplied = null

    if (streakAdvanced && newStreak > 0 && newStreak % 7 === 0) {
      coinsToAdd   = 3
      bonusApplied = 69
    }

    // ── Step 4: persist atomically ──────────────────────────────────────────
    // $set for streak because it can reset to 1, not just increment. We hold the
    // claim slot from step 1, so no concurrent claim can interleave here.
    const updated = await User.findOneAndUpdate(
      { _id: pre._id },
      {
        $inc: {
          coins:        coinsToAdd,
          bonusBalance: bonusApplied || 0
        },
        $set: {
          streak:         newStreak,
          lastStreakDate: now
        }
      },
      { new: true }
    )

    if (!updated) {
      return res.status(500).json({ message: 'Failed to update user' })
    }

    // Audit write is best-effort; don't 500 the claim if logging fails.
    try {
      await Activity.create({
        userId:      updated._id,
        username:    updated.username,
        type:        'claim',
        description: `claimed ${coinsToAdd} coin${coinsToAdd > 1 ? 's' : ''}${
          bonusApplied ? ` + ${bonusApplied}% streak bonus` : ''
        }`
      })
    } catch (actErr) {
      console.log('Activity log error:', actErr.message)
    }

    res.json({
      newBalance:   updated.coins,
      streak:       updated.streak,
      bonusApplied,
      coinsAdded:   coinsToAdd
    })
  } catch (err) {
    console.error('claim-coin error:', err.message)
    res.status(500).json({ message: 'Failed to claim coin' })
  }
})

// POST /api/game/spin
//
// RACE-FREE: the coin check and the deduction happen in ONE atomic update with
// the balance guard in the filter. Previously two parallel spins could both
// read coins === 1 and both spend it.
router.post('/spin', protect, async (req, res) => {
  try {
    const isAdmin = Boolean(req.user.isAdmin)

    // Decide the outcome first; the write below is then a single operation.
    const result = spinWheel()

    // Admins have unlimited coins, so no balance guard is applied for them.
    const filter = isAdmin
      ? { _id: req.user._id }
      : { _id: req.user._id, coins: { $gte: 1 } }

    const inc = isAdmin
      ? { totalSpins: 1, bonusBalance: result.value }
      : { coins: -1, totalSpins: 1, bonusBalance: result.value }

    const updated = await User.findOneAndUpdate(filter, { $inc: inc }, { new: true })

    // A non-admin whose balance dropped below 1 between request and update gets
    // null here — the guard in the filter prevented an overdraft.
    if (!updated) {
      return res.status(400).json({ message: 'Not enough coins to spin' })
    }

    try {
      await Activity.create({
        userId:      updated._id,
        username:    updated.username,
        type:        result.type === 'cash' ? 'win' : 'spin',
        description: result.type === 'cash'
          ? `won ${result.label} on the wheel!`
          : `spun the wheel and got ${result.label}`,
        // Persist the real outcome value so admin metrics can sum actual FP
        // payouts instead of assuming every win is worth $3.
        metadata: {
          outcomeId: result.id,
          label:     result.label,
          type:      result.type,
          value:     result.value
        }
      })
    } catch (actErr) {
      console.log('Activity log error:', actErr.message)
    }

    res.json({
      result,
      newBalance:   updated.coins,
      bonusBalance: updated.bonusBalance
    })
  } catch (err) {
    console.error('spin error:', err.message)
    res.status(500).json({ message: 'Spin failed' })
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
//
// AUTHZ FIX: this used findByIdAndUpdate(req.params.id, ...) with NO ownership
// check, so any authenticated user could mark any other user's notifications
// read by guessing/enumerating ids. The owner's _id is now part of the filter.
router.post('/notifications/:id/read', protect, async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid notification id' })
    }

    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { $set: { read: true } },
      { new: true }
    )

    if (!updated) {
      // Ambiguous on purpose: don't reveal whether the id belongs to someone
      // else or doesn't exist.
      return res.status(404).json({ message: 'Notification not found' })
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
