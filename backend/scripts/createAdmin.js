// config/env loads .env and validates required secrets.
const { MONGODB_URI, requireEnv } = require('../config/env')

const mongoose = require('mongoose')

// Use the REAL User model rather than an inline copy. The inline schema had
// already drifted (no `lowercase: true`, no comparePassword), so admins created
// by this script behaved differently from users created by the API.
//
// IMPORTANT: the User schema hashes `password` in a pre('save') hook, so pass
// the PLAINTEXT password to the constructor — hashing here would double-hash
// and make the account impossible to log into.
const User = require('../models/User')

// ── Admin credentials come from .env — never hardcoded ──────────────────────
// This file previously contained a hardcoded default admin password, committed
// to the repository. Anyone with repo access (or the git history) knows it, so
// treat it as compromised: pick a fresh ADMIN_PASSWORD and reset the existing
// admin account via POST /api/admin/users/:id/reset-password.
const ADMIN_USERNAME = requireEnv('ADMIN_USERNAME', { minLength: 3 })
const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD', { minLength: 8 })

async function createAdmin() {
  console.log('Connecting to MongoDB...')

  try {
    await mongoose.connect(MONGODB_URI)
    console.log('\u2705 Connected to MongoDB')

    const normalizedName = ADMIN_USERNAME.trim().toLowerCase()

    const existing = await User.findOne({ username: normalizedName })
    if (existing) {
      console.log('\u26A0\uFE0F  Admin user already exists!')
      console.log(`   Username: ${existing.username}`)
      console.log(`   isAdmin:  ${existing.isAdmin}`)
      if (!existing.isAdmin) {
        console.log('   Promoting existing account to admin...')
        existing.isAdmin = true
        await existing.save()
        console.log('   \u2705 Promoted.')
      }
      await mongoose.disconnect()
      process.exit(0)
    }

    const admin = await User.create({
      username: normalizedName,
      password: ADMIN_PASSWORD, // hashed by the schema's pre('save') hook
      isAdmin:  true,
      coins:    999999999
    })

    console.log('')
    console.log('\uD83C\uDF89 Admin created successfully!')
    console.log('\u2501'.repeat(32))
    console.log(`   Username: ${admin.username}`)
    // The password is deliberately NOT echoed. It lives in .env; printing it
    // copies a live credential into shell history, CI logs and log aggregators.
    console.log('   Password: (set via ADMIN_PASSWORD in .env)')
    console.log('\u2501'.repeat(32))
    console.log('')

    await mongoose.disconnect()
    process.exit(0)

  } catch (err) {
    console.error('\u274C Error creating admin:', err.message)
    await mongoose.disconnect().catch(() => {})
    process.exit(1)
  }
}

createAdmin()
