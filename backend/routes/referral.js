const router      = require('express').Router()
const User        = require('../models/User')
const Activity    = require('../models/Activity')
const Notification= require('../models/Notification')
const { protect } = require('../middleware/authMiddleware')

router.use(protect)

// GET /api/referral/stats
router.get('/stats', async (req, res) => {
  try {
    const referrals = await User.countDocuments({ referredBy: req.user._id })
    res.json({
      referrals,
      earned: referrals * 5
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/referral/apply
router.post('/apply', async (req, res) => {
  try {
    const { code } = req.body

    if (!code) {
      return res.status(400).json({ message: 'Referral code required' })
    }

    const user = await User.findById(req.user._id)

    if (user.referredBy) {
      return res.status(400).json({ message: 'You have already used a referral code' })
    }

    const referrer = await User.findOne({ referralCode: code.toUpperCase() })

    if (!referrer) {
      return res.status(404).json({ message: 'Invalid referral code' })
    }

    if (referrer._id.equals(user._id)) {
      return res.status(400).json({ message: 'You cannot use your own referral code' })
    }

    // Apply referral
    user.referredBy  = referrer._id
    user.coins      += 5
    await user.save()

    // Reward referrer
    referrer.coins += 5
    await referrer.save()

    // Notify referrer
    await Notification.create({
      userId:  referrer._id,
      title:   '👥 New Referral!',
      message: `${user.username} joined using your referral link! You earned 5 coins!`,
      type:    'referral'
    })

    await Activity.create({
      userId:      referrer._id,
      username:    referrer.username,
      type:        'referral',
      description: `${user.username} joined using their referral code — earned 5 coins`
    })

    res.json({
      message:    'Referral applied successfully',
      newBalance: user.coins,
      coinsAdded: 5
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router