const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    token: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      required: true, // employee | manager | hr | superadmin
    },

    tokenType: {
      type: String,
      enum: ['employee', 'manager', 'hr', 'superadmin'],
      required: true,
    },

    issuedAt: {
      type: Date,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// ⚡ One active token per user
tokenSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Token', tokenSchema);
