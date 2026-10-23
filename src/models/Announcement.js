const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  
  type: { 
    type: String, 
    enum: ['general', 'holiday', 'event', 'policy', 'urgent'], 
    default: 'general' 
  },
  
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high'], 
    default: 'medium' 
  },
  
  targetAudience: {
    type: { type: String, enum: ['all', 'department', 'specific'], default: 'all' },
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  
  attachments: [{
    fileName: String,
    fileUrl: String
  }],
  
  publishDate: { type: Date, default: Date.now },
  expiryDate: Date,
  
  isActive: { type: Boolean, default: true },
  
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Announcement', announcementSchema);