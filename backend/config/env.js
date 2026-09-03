const path = require('path')

// Load .env FIRST, before anything else reads process.env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const NODE_ENV = process.env.NODE_ENV || 'development'
const isProd   = NODE_ENV === 'production'

/**
 * Hard-require an environment variable. Exits the process if it is missing.
 *
 * There are deliberately NO fallback/default secrets anywhere in this codebase.
 * A default secret is worse than a crash: two processes started with different
 * (or absent) .env files would silently sign/verify tokens under different keys,
 * and a missing JWT_SECRET would ship a publicly known signing key.
 */
function requireEnv(name, { minLength = 1 } = {}) {
  const value = process.env[name]

  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    console.error(`\u274C FATAL: ${name} is required but missing from .env`)
    console.error(`   Add ${name} to ${path.join(__dirname, '..', '.env')}`)
    process.exit(1)
  }

  if (value.length < minLength) {
    console.error(
      `\u274C FATAL: ${name} must be at least ${minLength} characters (got ${value.length})`
    )
    process.exit(1)
  }

  return value.trim()
}

/**
 * Optional variable. Returns `fallback` when unset (used for non-secret config
 * like ports and URLs only \u2014 never for secrets).
 */
function optionalEnv(name, fallback) {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : fallback
}

// ── Secrets: required, no fallbacks, process exits if absent ────────────────
const JWT_SECRET    = requireEnv('JWT_SECRET', { minLength: 32 })
const MONGODB_URI   = requireEnv('MONGODB_URI')

// ── Non-secret configuration ────────────────────────────────────────────────
const PORT       = Number(optionalEnv('PORT', 5000))
const CLIENT_URL = optionalEnv('CLIENT_URL', 'http://localhost:5173')

// ── VAPID (web push) keys ───────────────────────────────────────────────────
// Optional: the app must still boot without push configured, otherwise a
// missing key pair takes the whole API down. routes/push.js guards on these.
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY?.trim()  || null
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || null
const VAPID_SUBJECT     = optionalEnv('VAPID_SUBJECT', 'mailto:admin@lisasweeps.com')
const pushEnabled       = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)

if (!pushEnabled) {
  console.warn(
    '\u26A0\uFE0F  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set \u2014 web push is disabled.'
  )
}

// Warn loudly when a weak/placeholder secret is used outside development.
if (isProd && /change[-_ ]?me|placeholder|example|your[-_]?secret/i.test(JWT_SECRET)) {
  console.error('\u274C FATAL: JWT_SECRET looks like a placeholder and NODE_ENV=production')
  process.exit(1)
}

module.exports = {
  NODE_ENV,
  isProd,
  PORT,
  CLIENT_URL,
  MONGODB_URI,
  JWT_SECRET,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  pushEnabled,
  requireEnv,
  optionalEnv
}
