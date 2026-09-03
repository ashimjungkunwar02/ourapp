const express  = require('express')
const jwt      = require('jsonwebtoken')
const bcrypt   = require('bcryptjs')

const router   = express.Router()

// ── Import models ─────────────────────────────────────────
const User     = require('../models/User')
const Activity = require('../models/Activity')

// ── Helper: sign token ────────────────────────────────────
const signToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'fallbacksecret',
    { expiresIn: '30d' }
  )
}

// ── Middleware: protect ───────────────────────────────────
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token' })
    }
    const token   = header.split(' ')[1]
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'fallbacksecret'
    )
    const user = await User.findById(decoded.id).select('-password')
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }
    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// ─────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body.username)

    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({
        message: 'Username and password required'
      })
    }

    // Find user
    const user = await User.findOne({ username: username })
    console.log('User found:', user ? 'YES' : 'NO')

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    // Check password
    const isMatch = await user.comparePassword(password)
    console.log('Password match:', isMatch)

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' })
    }

    // Update last login
    user.lastLogin = new Date()
    await user.save()

    // Log activity
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

    // Send response
    const token = signToken(user._id)
    console.log('Login successful for:', user.username)

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
    console.error('Login error:', err)
    res.status(500).json({ message: err.message })
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
  res.json({ message: 'Logged out' })
})

module.exports = router