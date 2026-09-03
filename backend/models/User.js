const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

const userSchema = new mongoose.Schema(
  {
    username: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
      // Normalise on write AND on query-cast. Without this, an account created
      // as "Alice" is unreachable by logging in as "alice" (and vice versa),
      // and two users can hold the same name in different cases.
      lowercase: true
    },
    password: {
      type:     String,
      required: true
    },
    isAdmin: {
      type:    Boolean,
      default: false
    },
    coins: {
      type:    Number,
      default: 0
    },
    streak: {
      type:    Number,
      default: 0
    },
    lastClaim: {
      type:    Date,
      default: null
    },
    lastStreakDate: {
      type:    Date,
      default: null
    },
    lastLogin: {
      type:    Date,
      default: null
    },
    referralCode: {
      type:    String,
      default: function() {
        return Math.random().toString(36).slice(2,10).toUpperCase()
      }
    },
    referredBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null
    },
    totalSpins: {
      type:    Number,
      default: 0
    },
    bonusBalance: {
      type:    Number,
      default: 0
    },
    pushSubscription: {
      type:    Object,
      default: null
    }
  },
  {
    timestamps: true
  }
)

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()
  try {
    const salt    = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (err) {
    next(err)
  }
})

userSchema.methods.comparePassword = async function(plainPassword) {
  try {
    return await bcrypt.compare(plainPassword, this.password)
  } catch (err) {
    return false
  }
}

const User = mongoose.model('User', userSchema)

module.exports = User