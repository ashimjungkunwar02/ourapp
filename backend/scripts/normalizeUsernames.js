/**
 * One-off migration: lowercase existing usernames.
 *
 * Adding `lowercase: true` to the schema normalises NEW writes and query casts,
 * but documents already stored as "Alice" stay "Alice". Run this once after
 * deploying the schema change.
 *
 *   node scripts/normalizeUsernames.js          # dry run (default)
 *   node scripts/normalizeUsernames.js --apply  # actually write
 *
 * Lowercasing can COLLIDE (both "Alice" and "alice" may exist, and username has
 * a unique index). Collisions are reported and skipped rather than crashing
 * mid-migration — resolve those accounts manually.
 */
const { MONGODB_URI } = require('../config/env')
const mongoose = require('mongoose')
const User     = require('../models/User')

const apply = process.argv.includes('--apply')

async function run() {
  await mongoose.connect(MONGODB_URI)
  console.log('\u2705 Connected to MongoDB')
  console.log(apply ? '\uD83D\uDD27 APPLY mode \u2014 writes will be made'
                    : '\uD83D\uDC41  DRY RUN \u2014 pass --apply to write')

  const users = await User.find({}).select('_id username').lean()

  const needsFix = users.filter(u => u.username && u.username !== u.username.toLowerCase())
  console.log(`\n${users.length} user(s) total, ${needsFix.length} with non-lowercase usernames`)

  // Detect collisions: group all usernames by their lowercased form.
  const seen = new Map()
  for (const u of users) {
    const key = (u.username || '').toLowerCase()
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(u.username)
  }

  let fixed = 0
  const skipped = []

  for (const u of needsFix) {
    const target = u.username.toLowerCase()

    if (seen.get(target).length > 1) {
      skipped.push({ _id: u._id, from: u.username, to: target,
                     reason: `collides with: ${seen.get(target).join(', ')}` })
      continue
    }

    if (apply) {
      // bypassValidation isn't needed, but updateOne avoids re-running setters
      // on unrelated fields.
      await User.updateOne({ _id: u._id }, { $set: { username: target } })
    }
    console.log(`   ${u.username}  ->  ${target}${apply ? '' : '  (dry run)'}`)
    fixed++
  }

  if (skipped.length > 0) {
    console.log(`\n\u26A0\uFE0F  ${skipped.length} skipped due to collisions:`)
    skipped.forEach(s => console.log(`   ${s.from} -> ${s.to} : ${s.reason}`))
    console.log('   Resolve these manually (rename or merge) before re-running.')
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${fixed}`)

  await mongoose.disconnect()
  process.exit(skipped.length > 0 ? 2 : 0)
}

run().catch(err => {
  console.error('\u274C Migration failed:', err.message)
  process.exit(1)
})
