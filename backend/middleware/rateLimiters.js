const { rateLimit } = require('express-rate-limit')
const { isProd }    = require('../config/env')

/**
 * Shared helper for consistent limiter configuration.
 *
 * `standardHeaders: 'draft-7'` sends RateLimit-* headers; `legacyHeaders: false`
 * suppresses the old X-RateLimit-* ones.
 */
const makeLimiter = ({ windowMs, limit, message }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Do not leak stack traces to the client on limiter validation errors.
    validate: { xForwardedForHeader: false },
    handler: (req, res) => {
      res.status(429).json({ message })
    },
    message
  })

// ── Login: brute-force protection ───────────────────────────────────────────
// Keyed per IP. Deliberately tighter than the general limiter because this is
// the credential-guessing surface.
const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 10 : 50,
  message: 'Too many login attempts. Please try again in 15 minutes.'
})

// ── Auth endpoints generally (login, logout, profile) ───────────────────────
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 100 : 500,
  message: 'Too many authentication requests. Please slow down.'
})

// ── Admin mutations (rain, bonus launch, point adjustments) ─────────────────
// These move money/coins for every user, so they get their own tighter budget.
const adminMutationLimiter = makeLimiter({
  windowMs: 10 * 60 * 1000,
  limit: isProd ? 30 : 200,
  message: 'Too many admin actions. Please try again shortly.'
})

// ── Game actions (spin, claim) ──────────────────────────────────────────────
// Loose enough for real play, tight enough to blunt scripted abuse.
const gameLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: isProd ? 60 : 300,
  message: 'Too many game actions. Please slow down.'
})

// ── Catch-all for the rest of the API ───────────────────────────────────────
const apiLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: isProd ? 500 : 5000,
  message: 'Too many requests. Please try again later.'
})

module.exports = {
  loginLimiter,
  authLimiter,
  adminMutationLimiter,
  gameLimiter,
  apiLimiter
}
