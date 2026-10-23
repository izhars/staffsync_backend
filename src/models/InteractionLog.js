// models/InteractionLog.js
const mongoose = require('mongoose');

const interactionLogSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  interactionType: {
    type: String,
    enum: [
      'viewed_profile',
      'viewed_contact',
      'messaged',
      'shared_profile',
      'saved_contact',
      'downloaded_resume',
      'started_call',
      'accepted_call',
      'declined_call',
      'ended_call',
      'missed_call',
      'emailed',
      'commented',
      'rated'
    ],
    required: true,
    index: true
  },
  notificationSent: {
    type: Boolean,
    default: false
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for common queries
interactionLogSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
interactionLogSchema.index({ receiverId: 1, interactionType: 1, timestamp: -1 });
interactionLogSchema.index({ timestamp: -1 });

// Virtual for readable interaction type
interactionLogSchema.virtual('readableType').get(function() {
  const types = {
    'viewed_profile': 'Viewed Profile',
    'viewed_contact': 'Viewed Contact',
    'messaged': 'Messaged',
    'shared_profile': 'Shared Profile',
    'saved_contact': 'Saved Contact',
    'downloaded_resume': 'Downloaded Resume',
    'started_call': 'Started Call',
    'accepted_call': 'Accepted Call',
    'declined_call': 'Declined Call',
    'ended_call': 'Ended Call',
    'emailed': 'Emailed',
    'commented': 'Commented',
    'rated': 'Rated'
  };
  return types[this.interactionType] || this.interactionType;
});

module.exports = mongoose.model('InteractionLog', interactionLogSchema);