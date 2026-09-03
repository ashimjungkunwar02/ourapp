const router   = require('express').Router()
const webpush  = require('web-push')
const User     = require('../models/User')
const { protect } = require('../middleware/authMiddleware')

webpush.setVapidDetails(
  'mailto:admin@lisasweeps.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
)

// POST /api/push/subscribe
router.post('/subscribe', protect, async (req, res) => {
  try {
    const { subscription } = req.body

    if (!subscription) {
      return res.status(400).json({ message: 'Subscription object required' })
    }

    await User.findByIdAndUpdate(req.user._id, {
      pushSubscription: subscription
    })

    res.json({ message: 'Push subscription saved' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/push/unsubscribe
router.post('/unsubscribe', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $unset: { pushSubscription: 1 }
    })
    res.json({ message: 'Unsubscribed from push notifications' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Helper: send push to one user
const sendPushToUser = async (userId, payload) => {
  try {
    const user = await User.findById(userId).select('pushSubscription')
    if (!user?.pushSubscription) return

    await webpush.sendNotification(
      user.pushSubscription,
      JSON.stringify(payload)
    )
  } catch (err) {
    if (err.statusCode === 410) {
      await User.findByIdAndUpdate(userId, {
        $unset: { pushSubscription: 1 }
      })
    }
  }
}

// Helper: send push to all users
const sendPushToAll = async (payload) => {
  try {
    const users = await User.find({
      pushSubscription: { $exists: true, $ne: null },
      isAdmin:          false
    }).select('_id pushSubscription')

    await Promise.allSettled(
      users.map(u =>
        webpush
          .sendNotification(u.pushSubscription, JSON.stringify(payload))
          .catch(err => {
            if (err.statusCode === 410) {
              User.findByIdAndUpdate(u._id, { $unset: { pushSubscription: 1 } })
            }
          })
      )
    )
  } catch (err) {
    console.error('Send push to all error:', err.message)
  }
}

module.exports = { router, sendPushToUser, sendPushToAll }