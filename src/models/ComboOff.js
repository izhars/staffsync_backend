const mongoose = require('mongoose');

const comboOffSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    workDate: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    usedInLeave: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Leave', 
    default: null 
  },
  isCredited: { type: Boolean, default: false }
  },
  { timestamps: true }
);

comboOffSchema.index({ employee: 1, workDate: 1 }, { unique: true }); // Prevent duplicate requests for same date

module.exports = mongoose.model('ComboOff', comboOffSchema);
