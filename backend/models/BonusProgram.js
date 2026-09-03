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
    type:     String,
    required: true
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