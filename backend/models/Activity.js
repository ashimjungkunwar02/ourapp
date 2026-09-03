const mongoose = require('mongoose')

const activitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
    default: null
  },
  username: {
    type:    String,
    default: 'unknown'
  },
  type: {
    type: String,
    enum: ['spin', 'claim', 'login', 'bonus', 'referral', 'win', 'admin'],
    default: 'login'
  },
  description: {
    type:    String,
    default: ''
  },
  metadata: {
    type:    Object,
    default: {}
  }
}, { timestamps: true })

module.exports = mongoose.model('Activity', activitySchema)