const mongoose = require('mongoose')

const notificationSchema = new mongoose.Schema({
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true
  },
  title: {
    type:     String,
    required: true
  },
  message: {
    type:     String,
    required: true
  },
  type: {
    type:    String,
    // 'rain' is emitted by POST /api/admin/rain — it must be a legal value or
    // every coin-rain notification fails validation and is silently dropped.
    enum:    ['bonus', 'referral', 'rain', 'system'],
    default: 'system'
  },
  read: {
    type:    Boolean,
    default: false
  }
}, { timestamps: true })

module.exports = mongoose.model('Notification', notificationSchema)