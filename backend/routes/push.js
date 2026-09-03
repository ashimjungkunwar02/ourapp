const router   = require('express').Router()
const webpush  = require('web-push')
const User     = require('../models/User')
const { protect } = require('../middleware/authMiddleware')
const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  pushEnabled
} = require('../config/env')

// ── VAPID setup ─────────────────────────────────────────────────────────────
// web-push THROWS synchronously if given undefined keys. Since this module is
// required at server boot, an unset key pair would take the entire API down.
// Configure only when both keys are present; routes below degrade gracefully.
if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

/** Minimal sanity check on a PushSubscription payload before persisting it. */
const isValidSubscription = (sub) =>
  Boolean(
    sub &&
    typeof sub === 'object' &&
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('http') &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  )

// ── GET /api/push/status ────────────────────────────────────────────────────
// Lets the client discover whether server-side push is configured at all,
// so the UI can hide the prompt instead of failing silently.
router.get('/status', protect, (req, res) => {
  res.json({
    enabled: pushEnabled,
    publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null,
    subscribed: Boolean(req.user.pushSubscription)
  })
})

// ── GET /api/push/vapid-public-key ──────────────────────────────────────────
// Public by design: the VAPID public key is needed by the browser to subscribe
// and is not a secret.
router.get('/vapid-public-key', (req, res) => {
  if (!pushEnabled) {
    return res.status(503).json({ message: 'Push notifications are not configured' })
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY })
})

// ── POST /api/push/subscribe ────────────────────────────────────────────────
router.post('/subscribe', protect, async (req, res) => {
  try {
    if (!pushEnabled) {
      return res.status(503).json({
        message: 'Push notifications are not configured on this server'
      })
    }

    const { subscription } = req.body

    if (!subscription) {
      return res.status(400).json({ message: 'Subscription object required' })
    }

    if (!isValidSubscription(subscription)) {
      return res.status(400).json({
        message: 'Malformed subscription: expected endpoint and keys.p256dh / keys.auth'
      })
    }

    await User.findByIdAndUpdate(req.user._id, { pushSubscription: subscription })

    res.json({ message: 'Push subscription saved' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── POST /api/push/unsubscribe ──────────────────────────────────────────────
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

// ── Helper: send push to one user ───────────────────────────────────────────
const sendPushToUser = async (userId, payload) => {
  if (!pushEnabled) return false
  try {
    const user = await User.findById(userId).select('pushSubscription')
    if (!user?.pushSubscription) return false

    await webpush.sendNotification(user.pushSubscription, JSON.stringify(payload))
    return true
  } catch (err) {
    // 404/410 == the subscription is dead; drop it so we stop retrying.
    if (err.statusCode === 404 || err.statusCode === 410) {
      await User.findByIdAndUpdate(userId, { $unset: { pushSubscription: 1 } })
    } else {
      console.error('sendPushToUser error:', err.message)
    }
    return false
  }
}

// ── Helper: send push to all users ──────────────────────────────────────────
const sendPushToAll = async (payload) => {
  if (!pushEnabled) return { sent: 0, failed: 0 }
  try {
    const users = await User.find({
      pushSubscription: { $exists: true, $ne: null },
      isAdmin: false
    }).select('_id pushSubscription')

    const results = await Promise.allSettled(
      users.map(u =>
        webpush
          .sendNotification(u.pushSubscription, JSON.stringify(payload))
          .catch(err => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              return User.findByIdAndUpdate(u._id, { $unset: { pushSubscription: 1 } })
                .then(() => Promise.reject(err))
            }
            return Promise.reject(err)
          })
      )
    )

    return {
      sent:   results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    }
  } catch (err) {
    console.error('sendPushToAll error:', err.message)
    return { sent: 0, failed: 0 }
  }
}

module.exports = { router, sendPushToUser, sendPushToAll }
