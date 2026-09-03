require('dotenv').config({ 
  path: require('path').join(__dirname, '..', '.env') 
})

const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

// ── Simple User Schema (inline so no import issues) ──────────
const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true },
  password:     { type: String, required: true },
  isAdmin:      { type: Boolean, default: false },
  coins:        { type: Number, default: 0 },
  streak:       { type: Number, default: 0 },
  referralCode: { type: String, default: () => Math.random().toString(36).slice(2, 10).toUpperCase() }
}, { timestamps: true })

const User = mongoose.model('User', userSchema)

// ── Admin credentials — change these! ───────────────────────
const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'Admin@12345'

async function createAdmin() {
  console.log('Connecting to MongoDB...')
  console.log('URI:', process.env.MONGODB_URI ? 'Found ✅' : 'MISSING ❌')

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in .env file')
    console.error('Make sure your .env file exists in the backend folder')
    process.exit(1)
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('✅ Connected to MongoDB')

    // Check if admin exists
    const existing = await User.findOne({ username: ADMIN_USERNAME })
    if (existing) {
      console.log('⚠️  Admin user already exists!')
      console.log(`   Username: ${existing.username}`)
      console.log(`   isAdmin:  ${existing.isAdmin}`)
      await mongoose.disconnect()
      process.exit(0)
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12)

    // Create admin
    const admin = new User({
      username: ADMIN_USERNAME,
      password: hashedPassword,
      isAdmin:  true,
      coins:    999999999
    })
    await admin.save()

    console.log('')
    console.log('🎉 Admin created successfully!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`   Username: ${ADMIN_USERNAME}`)
    console.log(`   Password: ${ADMIN_PASSWORD}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('⚠️  Save these credentials safely!')
    console.log('')

    await mongoose.disconnect()
    process.exit(0)

  } catch (err) {
    console.error('❌ Error creating admin:', err.message)
    await mongoose.disconnect()
    process.exit(1)
  }
}

createAdmin()