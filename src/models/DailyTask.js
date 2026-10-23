const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  tasks: [{
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    project: {
      type: String,
      trim: true
    },
    timeSpent: {
      type: Number, // in minutes
      required: true,
      min: 0
    },
    category: {
      type: String,
      enum: ['development', 'meeting', 'testing', 'documentation', 'research', 'support', 'other'],
      default: 'development'
    }
  }],
  totalTime: {
    type: Number, // in minutes
    default: 0
  },
  notes: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved'],
    default: 'draft'
  }
}, {
  timestamps: true
});

// Calculate total time before saving
taskSchema.pre('save', function(next) {
  this.totalTime = this.tasks.reduce((total, task) => total + task.timeSpent, 0);
  next();
});

// Compound index for user and date
taskSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyTask', taskSchema);