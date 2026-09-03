const express = require('express')
const jwt     = require('jsonwebtoken')

const router = express.Router()

// ── Import models ─────────────────────────────────────────
const User     = require('../models/User')
const Activity = require('../models/Activity')

// Single source of truth for auth. This file previously carried its own copy of
// `protect` plus a DIFFERENT fallback secret ('fallbacksecret' here vs
// 'fallback_secret' in middleware/authMiddleware.js), so a token signed on one
// code path could fail verification on the other.
const { protect }     = require('../middleware/authMiddleware')
const { JWT_SECRET }  = require('../config/env')

// ── Helper: sign token ────────────────────────────────────
// No fallback secret. config/env.js exits at boot if JWT_SECRET is unset, and
// the algorithm is pinned so an attacker can't negotiate 'none'.
const signToken = (id) =>
  jwt.sign({ id: String(id) }, JWT_SECRET, {
    expiresIn: '30d',
    algorithm: 'HS256'
  })

// ─────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({
        message: 'Username and password required'
      })
    }

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        message: 'Username and password must be strings'
      })
    }

    // Lowercase + trim before querying. The schema casts on write, but accounts
    // created before `lowercase: true` was added may still be mixed-case, so
    // normalise on the read path too. See scripts/normalizeUsernames.js.
    const normalizedUsername = username.trim().toLowerCase()

    if (!normalizedUsername) {
      return res.status(400).json({ message: 'Username and password required' })
    }

    const user = await User.findOne({ username: normalizedUsername })

    if (!user) {
      // Same message as a bad password so this can't be used to enumerate
      // which usernames exist.
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    // Update last login. Use updateOne rather than save() so we don't race with
    // a concurrent coin/spin update on the same document.
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    )
    user.lastLogin = new Date()

    // Log activity (best-effort; never fail a login over an audit write)
    try {
      await Activity.create({
        userId:      user._id,
        username:    user.username,
        type:        'login',
        description: 'logged in'
      })
    } catch (actErr) {
      console.log('Activity log error:', actErr.message)
    }

    const token = signToken(user._id)

    res.json({
      token,
      user: {
        _id:          user._id,
        username:     user.username,
        isAdmin:      user.isAdmin,
        coins:        user.coins,
        streak:       user.streak,
        referralCode: user.referralCode
      }
    })

  } catch (err) {
    console.error('Login error:', err.message)
    res.status(500).json({ message: 'Login failed' })
  }
})

// ─────────────────────────────────────────────────────────
// GET /api/auth/profile
// ─────────────────────────────────────────────────────────
router.get('/profile', protect, async (req, res) => {
  try {
    res.json({
      _id:          req.user._id,
      username:     req.user.username,
      isAdmin:      req.user.isAdmin,
      coins:        req.user.coins,
      streak:       req.user.streak,
      referredBy:   req.user.referredBy || null,
      referralCode: req.user.referralCode
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    await Activity.create({
      userId:      req.user._id,
      username:    req.user.username,
      type:        'login',
      description: 'logged out'
    })
  } catch {
    // audit-only; ignore
  }
  res.json({ message: 'Logged out' })
})

module.exports = router
