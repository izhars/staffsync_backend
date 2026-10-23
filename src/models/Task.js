// models/Task.js
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assigner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  category: {
    type: String,
    enum: ['onboarding', 'offboarding', 'training', 'performance', 'compliance', 'general'],
    default: 'general'
  },

  status: { type: String, enum: ['open', 'completed'], default: 'open' },

  dueDate: { type: Date },
  completedAt: { type: Date },

  comments: [
    {
      text: { type: String, required: true, trim: true },
      author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      createdAt: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

// Helpful index for the common query patterns
taskSchema.index({ assignee: 1, status: 1 });
taskSchema.index({ dueDate: 1 });

module.exports = mongoose.model('Task', taskSchema);