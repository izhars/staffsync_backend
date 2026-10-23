const mongoose = require('mongoose');

const CelebrationGreetingSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    celebrationType: {
      type: String,
      enum: ['birthday', 'marriage', 'work'],
      required: true,
    },
    celebrationDate: { type: String, required: true }, // 'YYYY-MM-DD'
    message: { type: String, required: true, trim: true, maxlength: 500 },

    // pending → delivered | failed. 'rejected' is reserved for future moderation.
    status: {
      type: String,
      enum: ['pending', 'delivered', 'failed', 'rejected'],
      default: 'pending',
    },
    readAt: { type: Date, default: null },
    deliveryError: { type: String, default: null },
  },
  { timestamps: true }
);

CelebrationGreetingSchema.index(
  { from: 1, to: 1, celebrationType: 1, celebrationDate: 1 },
  { unique: true }
);

CelebrationGreetingSchema.index({ to: 1, status: 1, readAt: 1 });

module.exports = mongoose.model('CelebrationGreeting', CelebrationGreetingSchema);