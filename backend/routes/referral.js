const router       = require('express').Router()
const User         = require('../models/User')
const Activity     = require('../models/Activity')
const Notification = require('../models/Notification')
const { protect }  = require('../middleware/authMiddleware')

router.use(protect)

const REFERRAL_REWARD = 5

// GET /api/referral/stats
router.get('/stats', async (req, res) => {
  try {
    const referrals = await User.countDocuments({ referredBy: req.user._id })
    res.json({
      referrals,
      earned: referrals * REFERRAL_REWARD
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/referral/apply
//
// RACE-FREE: the old flow was findById -> `if (user.referredBy)` -> mutate ->
// save. Two parallel requests (double-click, or a replayed ?ref= link) both saw
// referredBy === null and BOTH credited the referrer. The `referredBy: null`
// condition is now part of the atomic update filter, so only the first write
// can succeed; every later one matches nothing.
router.post('/apply', async (req, res) => {
  try {
    const { code } = req.body

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Referral code required' })
    }

    const normalizedCode = code.trim().toUpperCase()

    // Cheap shape guard before hitting the DB.
    if (!/^[A-Z0-9]{4,16}$/.test(normalizedCode)) {
      return res.status(400).json({ message: 'Invalid referral code' })
    }

    const referrer = await User.findOne({ referralCode: normalizedCode })

    if (!referrer) {
      return res.status(404).json({ message: 'Invalid referral code' })
    }

    if (referrer._id.equals(req.user._id)) {
      return res.status(400).json({ message: 'You cannot use your own referral code' })
    }

    // ── Atomically claim the referral slot for THIS user ────────────────────
    // `referredBy: null` in the filter is the mutex. $exists:false covers
    // documents created before the field had an explicit default.
    const updated = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        $or: [
          { referredBy: null },
          { referredBy: { $exists: false } }
        ]
      },
      {
        $set: { referredBy: referrer._id },
        $inc: { coins: REFERRAL_REWARD }
      },
      { new: true }
    )

    if (!updated) {
      return res.status(400).json({ message: 'You have already used a referral code' })
    }

    // ── Credit the referrer (atomic increment, no read-modify-write) ────────
    await User.updateOne(
      { _id: referrer._id },
      { $inc: { coins: REFERRAL_REWARD } }
    )

    // Notification + audit are best-effort: the referral is already committed,
    // so a logging failure must not roll it back or 500 the response.
    try {
      await Notification.create({
        userId:  referrer._id,
        title:   '\uD83D\uDC65 New Referral!',
        message: `${updated.username} joined using your referral link! You earned ${REFERRAL_REWARD} coins!`,
        type:    'referral'
      })

      await Activity.create({
        userId:      referrer._id,
        username:    referrer.username,
        type:        'referral',
        description: `${updated.username} joined using their referral code \u2014 earned ${REFERRAL_REWARD} coins`
      })
    } catch (logErr) {
      console.log('Referral logging error:', logErr.message)
    }

    res.json({
      message:    'Referral applied successfully',
      newBalance: updated.coins,
      coinsAdded: REFERRAL_REWARD
    })
  } catch (err) {
    console.error('referral/apply error:', err.message)
    res.status(500).json({ message: 'Failed to apply referral code' })
  }
})

module.exports = router
