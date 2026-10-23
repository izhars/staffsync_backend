// models/Notification.js
const mongoose = require('mongoose');
const { NOTIFICATION_ROLES } = require('../constants/roles');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    // Role-based or system-wide target
    role: {
      type: String,
      enum: Object.values(NOTIFICATION_ROLES),
      default: null,
    },

    type: {
      type: String,
      enum: [
        // ── Flutter app ke NotificationType se match ──
        'general',
        'incoming_call',
        'call_declined',
        'call_missed',
        'call_ended',
        'call_accepted',
        'employee_interaction',
        'info',
        'warning',
        'success',
        'error',
        'system',
        'call',
        'meeting',
        'task',
        // ── Business domain types ──
        // Every value here must stay in sync with TYPE_TO_SETTING_MAP in
        // firebase/notificationService.js. A missing value causes Mongoose to
        // reject the insert and (via insertMany) break the calling flow.
        'leave',
        'leave_update',
        'attendance',
        'expense',
        'payroll',
        'asset',
        'announcement',
        'poll',
        'holiday',
        'award',
        'badge',
        'celebration',
        'security',
        'schedule_update',
        'message',
      ],
      default: 'general',     // ✅ default bhi 'general' karo
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    link: String,

    meta: {
      type: Object,
      default: {},
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Soft delete
    deleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: Date,
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Global broadcast flag
    isGlobal: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound indexes for common queries
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ user: 1, deleted: 1, createdAt: -1 });
notificationSchema.index({ role: 1, createdAt: -1 });
notificationSchema.index({ isGlobal: 1, createdAt: -1 });

// Text index for search (optional)
notificationSchema.index({ title: 'text', message: 'text' });

module.exports = mongoose.model('Notification', notificationSchema);