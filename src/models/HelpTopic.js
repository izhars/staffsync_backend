// models/helpTopic.js
const mongoose = require('mongoose');

const helpTopicSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    unique: true,
    trim: true,
    minlength: [2, 'Title must be at least 2 characters'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  icon: {
    type: String,
    trim: true,
    default: 'help'
  },
  description: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure unique index
helpTopicSchema.index({ title: 1 }, { unique: true });

module.exports = mongoose.model('HelpTopic', helpTopicSchema);