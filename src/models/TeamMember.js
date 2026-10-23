// models/TeamMember.js
const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true },
  bio: String,
  imageUrl: { type: String, default: '/default-avatar.png' },
  order: { type: Number, default: 0 }, // For sorting

  social: {
    linkedin: String,
    twitter: String,
    github: String,
    website: String
  },

  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Sort by order, then by creation date
teamMemberSchema.pre(/^find/, function() {
  this.sort({ order: 1, createdAt: -1 });
});

module.exports = mongoose.model('TeamMember', teamMemberSchema);