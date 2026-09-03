const jwt  = require('jsonwebtoken')
const User = require('../models/User')

// ── Protect: verify JWT token ─────────────────────────────
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization

    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' })
    }

    const token   = header.split(' ')[1]
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'fallback_secret'
    )

    const user = await User.findById(decoded.id).select('-password')
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }

    req.user = user
    next()

  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

// ── Admin only ────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' })
  }
  next()
}

module.exports = { protect, adminOnly }