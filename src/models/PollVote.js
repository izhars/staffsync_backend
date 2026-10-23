const mongoose = require('mongoose');

const PollVoteSchema = new mongoose.Schema({
  pollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  optionIndex: { type: Number, required: true },
  votedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PollVote', PollVoteSchema);
