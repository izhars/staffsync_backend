const mongoose = require('mongoose');

const AdminResponseSchema = new mongoose.Schema({
    message: { type: String },
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    respondedAt: { type: Date }
}, { _id: false });

const FeedbackSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function () { return !this.isAnonymous; }
  },
  message: { type: String, required: true },
  respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // removed required: true
  respondedAt: { type: Date },
  category: {
    type: String,
    enum: ['work_environment', 'management', 'benefits', 'other'],
    default: 'other'
  },
  isAnonymous: { type: Boolean, default: false },
  sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
  adminResponse: AdminResponseSchema
}, { timestamps: true });

module.exports = mongoose.model('Feedback', FeedbackSchema);