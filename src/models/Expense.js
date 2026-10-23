const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExpenseCategory',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  receipt: {
    type: String,
    default: null
  },
  receiptPublicId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected'],
    default: 'draft'
  },
  submittedAt: {
    type: Date
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  approvalComments: {
    type: String
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  hrComments: {
    type: String
  }
}, {
  timestamps: true
});

// Index for better query performance
expenseSchema.index({ employee: 1, status: 1, createdAt: -1 });
expenseSchema.index({ status: 1, submittedAt: -1 });

module.exports = mongoose.model('Expense', expenseSchema);