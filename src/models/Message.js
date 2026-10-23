const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'file', 'video', 'audio'], required: true },
  url: { type: String, required: true },
  filename: { type: String, required: true },
  size: { type: Number },
  publicId: { type: String },
  mimeType: { type: String },
  dimensions: {
    width: Number,
    height: Number
  },
  thumbnailUrl: String
}, { _id: false });

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emoji: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  // For both direct and group messages
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // For direct messages (backward compatibility)
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // For group messages
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  
  // Common fields
  text: { type: String, default: '' },
  messageType: { 
    type: String, 
    enum: ['text', 'image', 'file', 'audio', 'video', 'system'],
    default: 'text'
  },
  
  // Sender info (denormalized for performance)
  senderName: { type: String, required: true },
  senderRole: { type: String, required: true },
  senderAvatar: String,
  
  // Media/attachment
  attachment: { type: attachmentSchema, default: null },
  
  // Message features
  reactions: { type: [reactionSchema], default: [] },
  isEdited: { type: Boolean, default: false },
  editedAt: Date,
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deleteType: { 
    type: String, 
    enum: ['none', 'sender', 'everyone'],
    default: 'none'
  },
  
  // Delivery status
  timestamp: { type: Date, default: Date.now },
  deliveredAt: Date,
  readAt: Date,
  readBy: [{ 
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now }
  }],
  
  // Reply/Forward
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  isForwarded: { type: Boolean, default: false },
  originalSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Metadata
  metadata: {
    clientId: String, // For client-side message tracking
    deviceId: String,
    platform: String
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
messageSchema.index({ sender: 1, timestamp: -1 });
messageSchema.index({ from: 1, to: 1, timestamp: -1 });
messageSchema.index({ conversationId: 1, timestamp: -1 });
messageSchema.index({ timestamp: -1 });
messageSchema.index({ 'readBy.userId': 1 });

// Virtual for backward compatibility
messageSchema.virtual('isDirect').get(function() {
  return !this.conversationId && this.to;
});

messageSchema.virtual('isGroup').get(function() {
  return !!this.conversationId;
});

// Pre-save hook to populate from/to for backward compatibility
messageSchema.pre('save', function(next) {
  if (this.isDirect && !this.from) {
    this.from = this.sender;
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema);