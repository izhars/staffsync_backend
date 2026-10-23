const mongoose = require('mongoose');

const aboutSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  slogan: String,
  description: { type: String, required: true },        // Supports HTML
  mission: String,
  vision: String,
  values: [String],
  
  // Stats for counter animation
  stats: [{
    label: String,
    value: Number,
    suffix: String  // e.g., "+", "K", "%"
  }],

  // Company timeline
  timeline: [{
    year: Number,
    title: String,
    description: String
  }],

  // Add this new field for achievements
  achievements: [String],

  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('About', aboutSchema);