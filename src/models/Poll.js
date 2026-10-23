// models/Poll.js
const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true
  },
  votes: {
    type: Number,
    default: 0,
    min: 0
  }
});

const pollSchema = new mongoose.Schema({
  question: {
    type: String,
    required: [true, 'Question is required'],
    trim: true,
    minlength: [5, 'Question must be at least 5 characters'],
    maxlength: [500, 'Question cannot exceed 500 characters']
  },
  
  options: {
    type: [optionSchema],
    validate: {
      validator: function(arr) {
        return arr && arr.length >= 2;
      },
      message: 'Poll must have at least 2 options'
    }
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  votedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  expiresAt: {
    type: Date,
    required: true,
    default: function() {
      // Default expiry: 7 days from now
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  },
  
  isClosed: {
    type: Boolean,
    default: false
  },
  
  allowMultiple: {
    type: Boolean,
    default: false
  },
  
  isAnonymous: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
pollSchema.index({ createdBy: 1, createdAt: -1 });
pollSchema.index({ expiresAt: 1, isClosed: 1 });
pollSchema.index({ votedUsers: 1 });

// Virtual for checking if poll is active
pollSchema.virtual('isActive').get(function() {
  return !this.isClosed && new Date(this.expiresAt) > new Date();
});

// Method to check if user has voted
pollSchema.methods.hasUserVoted = function(userId) {
  return this.votedUsers.some(id => id.toString() === userId.toString());
};

// Method to get total votes
pollSchema.methods.getTotalVotes = function() {
  return this.options.reduce((sum, opt) => sum + opt.votes, 0);
};

// Pre-save hook to validate expiry date
pollSchema.pre('save', function(next) {
  if (this.isNew && new Date(this.expiresAt) < new Date()) {
    next(new Error('Expiry date must be in the future'));
  } else {
    next();
  }
});

module.exports = mongoose.model('Poll', pollSchema);