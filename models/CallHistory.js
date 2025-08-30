const mongoose = require('mongoose');

const callHistorySchema = new mongoose.Schema({
  user1: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  user2: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastCalled: {
    type: Date,
    default: Date.now
  },
  duration: {
    type: Number, // in seconds
    default: 0
  },
  status: {
    type: String,
    enum: ['completed', 'missed', 'declined'],
    default: 'completed'
  }
}, {
  timestamps: true
});

// Ensure unique combination of user1 and user2
callHistorySchema.index({ user1: 1, user2: 1 }, { unique: true });

module.exports = mongoose.model('CallHistory', callHistorySchema);