const mongoose = require('mongoose');
const ticketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'in-progress', 'closed'], default: 'open' },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Ticket', ticketSchema);