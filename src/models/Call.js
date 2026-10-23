const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: {
    type: String,
    required: true,
    unique: true,
  },
  roomId: {
    type: String,
    required: true,
    unique: true,
  },
  callerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  calleeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['ringing', 'accepted', 'declined', 'ended', 'missed'],
    default: 'ringing',
  },
  type: {
    type: String,
    enum: ['audio', 'video'],
    default: 'video',
  },
  duration: {
    type: Number, // in seconds
    default: 0,
  },
  endedAt: {
    type: Date,
  }
}, { 
  timestamps: true 
});

// Pre-save middleware to calculate duration
callSchema.pre('save', function(next) {
  if (this.status === 'ended' && !this.endedAt) {
    this.endedAt = new Date();
    this.duration = Math.floor((this.endedAt - this.createdAt) / 1000);
  }
  next();
});

// Index for faster queries
callSchema.index({ callerId: 1, calleeId: 1, status: 1 });
callSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Call', callSchema);