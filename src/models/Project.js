// models/Project.js
const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: [200, 'Project name cannot exceed 200 characters']
    },
    code: {
      type: String,
      required: [true, 'Project code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9-]+$/, 'Project code can only contain uppercase letters, numbers and hyphens']
    },
    description: {
      type: String,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: ''
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required']
    },
    endDate: {
      type: Date,
      validate: {
        validator: function (value) {
          if (!value) return true; // allow null
          return value > this.startDate;
        },
        message: 'End date must be after start date'
      }
    },
    status: {
      type: String,
      enum: ['planning', 'active', 'on-hold', 'completed', 'cancelled', 'in-progress'],
      default: 'planning'
    },
    budget: {
      allocated: { type: Number, min: 0, default: 0 },
      currency: { type: String, default: 'INR', uppercase: true, trim: true }
      // 'spent' is REMOVED — now calculated via virtual from expenses
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    teamMembers: [
      {
        employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectRole' },
        allocation: { type: Number, min: 0, max: 100, default: 100 },
        startDate: { type: Date, default: Date.now },
        endDate: Date,
        isActive: { type: Boolean, default: true }
      }
    ],
    tags: [{
      type: String,
      trim: true
    }],
    expenses: [
      {
        amount: { type: Number, required: true, min: [0, 'Amount cannot be negative'] },
        remark: { 
          type: String, 
          trim: true, 
          maxlength: [500, 'Remark cannot exceed 500 characters'] 
        },
        date: { type: Date, default: Date.now },
        recordedBy: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: 'User', 
          required: true 
        }
      }
    ],
    documents: [
      {
        name: { type: String, required: true },
        url: { type: String, required: true },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now }
      }
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ────────────────────────────────────────────────
// Indexes for performance
// ────────────────────────────────────────────────
projectSchema.index({ code: 1 }, { unique: true });
projectSchema.index({ status: 1 });
projectSchema.index({ manager: 1 });
projectSchema.index({ 'teamMembers.employee': 1 });
projectSchema.index({ 'expenses.date': -1 });
projectSchema.index({ createdAt: -1 });

// ────────────────────────────────────────────────
// Virtuals
// ────────────────────────────────────────────────

// Project duration in days
projectSchema.virtual('duration').get(function () {
  if (!this.startDate || !this.endDate) return null;
  const diff = this.endDate - this.startDate;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Total spent — calculated from expenses array (always accurate)
projectSchema.virtual('budget.spent').get(function () {
  if (!this.expenses || this.expenses.length === 0) return 0;
  return this.expenses.reduce((total, expense) => total + expense.amount, 0);
});

// Budget utilization percentage
projectSchema.virtual('budgetUtilization').get(function () {
  const allocated = this.budget?.allocated || 0;
  const spent = this.budget?.spent || 0;
  if (allocated === 0) return 0;
  return Number(((spent / allocated) * 100).toFixed(2));
});

// Optional: Add a virtual for remaining budget
projectSchema.virtual('budget.remaining').get(function () {
  const allocated = this.budget?.allocated || 0;
  const spent = this.budget?.spent || 0;
  return Math.max(0, allocated - spent);
});

module.exports = mongoose.model('Project', projectSchema);