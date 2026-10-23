const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  // Basic info
  name: { type: String, trim: true },
  description: { type: String, trim: true },

  // Type of conversation
  type: {
    type: String,
    enum: ['direct', 'group', 'channel'],
    default: 'direct',
    required: true
  },

  // Participants
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      enum: ['member', 'admin', 'owner'],
      default: 'member'
    },
    joinedAt: { type: Date, default: Date.now },
    lastSeen: Date,
    notificationSettings: {
      mute: { type: Boolean, default: false },
      muteUntil: Date,
      sound: { type: Boolean, default: true }
    },
    isActive: { type: Boolean, default: true }
  }],

  // For direct messages
  isDirect: { type: Boolean, default: false },
  directParticipants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],

  // Group settings
  settings: {
    isPublic: { type: Boolean, default: false },
    approvalRequired: { type: Boolean, default: false },
    allowMedia: { type: Boolean, default: true },
    allowReactions: { type: Boolean, default: true },
    allowEditing: { type: Boolean, default: true },
    maxParticipants: { type: Number, default: 100 }
  },

  // Media
  avatar: {
    url: { type: String, default: '' },
    publicId: { type: String, default: '' }
  },

  // Last message info (denormalized for performance)
  lastMessage: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    text: String,
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: String,
    timestamp: Date,
    messageType: String,
    attachment: {
      type: String,
      enum: ['none', 'image', 'file', 'audio', 'video']
    }
  },

  // Stats
  messageCount: { type: Number, default: 0 },
  unreadCount: { type: Number, default: 0 },

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  archivedAt: Date,
  isArchived: { type: Boolean, default: false },

  // Custom fields
  tags: [String],
  category: String,
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
conversationSchema.index({ 'participants.user': 1, updatedAt: -1 });
conversationSchema.index({ type: 1, updatedAt: -1 });
conversationSchema.index({ isDirect: 1, directParticipants: 1 });
conversationSchema.index({ 'lastMessage.timestamp': -1 });
conversationSchema.index({ tags: 1 });
conversationSchema.index({ department: 1 });

// Virtual for active participants count
conversationSchema.virtual('activeParticipants').get(function () {
  return this.participants.filter(p => p.isActive).length;
});

// Virtual for admins
conversationSchema.virtual('admins').get(function () {
  return this.participants
    .filter(p => p.role === 'admin' || p.role === 'owner')
    .map(p => p.user);
});

// Pre-save hook for direct conversations
conversationSchema.pre('save', function (next) {
  if (this.type === 'direct' && this.participants.length === 2) {
    this.isDirect = true;
    this.directParticipants = this.participants.map(p => p.user);

    // Auto-generate name for direct chats
    if (!this.name) {
      this.name = 'Direct Chat';
    }
  }

  // Auto-update timestamps
  this.updatedAt = new Date();
  next();
});

// Method to add participant
conversationSchema.methods.addParticipant = function (userId, role = 'member') {
  if (this.participants.some(p => p.user.toString() === userId.toString())) {
    return false; // Already a participant
  }

  this.participants.push({
    user: userId,
    role: role,
    joinedAt: new Date()
  });

  return true;
};

// Method to remove participant
conversationSchema.methods.removeParticipant = function (userId) {
  const initialLength = this.participants.length;
  this.participants = this.participants.filter(
    p => p.user.toString() !== userId.toString()
  );

  return initialLength !== this.participants.length;
};

// Method to check if user is participant
conversationSchema.methods.isParticipant = function (userId) {
  return this.participants.some(
    p => p.user.toString() === userId.toString() && p.isActive
  );
};

// Method to get user's role
conversationSchema.methods.getUserRole = function (userId) {
  const participant = this.participants.find(
    p => p.user.toString() === userId.toString()
  );
  return participant ? participant.role : null;
};

module.exports = mongoose.model('Conversation', conversationSchema);