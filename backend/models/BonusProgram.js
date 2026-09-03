const mongoose = require('mongoose')

const bonusProgramSchema = new mongoose.Schema({
  type: {
    type:     String,
    enum:     ['deposit', 'referral'],
    required: true
  },
  percentage: {
    type:     Number,
    required: true,
    min:      1,
    max:      500
  },
  message: {
    type: String,
    // Not `required: true`: admins routinely launch a bonus without typing
    // custom copy, and a hard requirement made the whole launch 500. The route
    // derives a sensible default when the field is omitted, so the value is
    // always a non-empty string by the time it reaches the DB.
    default: '',
    trim: true,
    maxlength: 500
  },
  validHours: {
    type:     Number,
    required: true
  },
  expiresAt: {
    type:     Date,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User'
  },
  isActive: {
    type:    Boolean,
    default: true
  },
  usersNotified: {
    type:    Number,
    default: 0
  }
}, { timestamps: true })

const BonusProgram = mongoose.model('BonusProgram', bonusProgramSchema)

module.exports = BonusProgram