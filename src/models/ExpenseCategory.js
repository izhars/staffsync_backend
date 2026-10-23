const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    maxlength: 50
  },
  description: { 
    type: String,
    trim: true,
    maxlength: 200
  },
  maxAmount: { 
    type: Number,
    min: 0
  },
  requiresApproval: { 
    type: Boolean, 
    default: true 
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

CategorySchema.index({ isActive: 1 });

module.exports = mongoose.model('ExpenseCategory', CategorySchema);