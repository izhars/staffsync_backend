const mongoose = require('mongoose');

const EmployeeInteractionSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    interactionType: {
      type: String,
      enum: [
        'viewed_profile',
        'viewed_contact',
        'messaged',
        'shared_profile',
        'saved_contact',
        'downloaded_resume',
        'started_call',
        'accepted_call',
        'declined_call',
        'missed_call',
        'ended_call'
      ],
      required: true
    },
    notificationSent: {
      type: Boolean,
      default: false
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

// Indexes for faster queries
EmployeeInteractionSchema.index({ senderId: 1, createdAt: -1 });
EmployeeInteractionSchema.index({ receiverId: 1, createdAt: -1 });
EmployeeInteractionSchema.index({ interactionType: 1 });

module.exports = mongoose.model('EmployeeInteraction', EmployeeInteractionSchema);