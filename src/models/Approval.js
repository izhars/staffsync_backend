const mongoose = require('mongoose');

const ApprovalSchema = new mongoose.Schema({
  expense: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Expense', 
    required: true 
  },
  approver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  level: { 
    type: Number, 
    default: 1,
    min: 1
  },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  comments: { 
    type: String,
    trim: true,
    maxlength: 500
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Composite index
ApprovalSchema.index({ expense: 1, approver: 1, level: 1 });
ApprovalSchema.index({ expense: 1, status: 1 });

module.exports = mongoose.model('Approval', ApprovalSchema);