// controllers/pollController.js
const Poll = require('../models/Poll');

// ✅ Helper to format poll response for frontend
const formatPollForUser = (poll, userId) => {
  const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes, 0);
  return {
    _id: poll._id,
    question: poll.question,
    expiresAt: poll.expiresAt,
    isClosed: poll.isClosed,
    allowMultiple: poll.allowMultiple,
    isAnonymous: poll.isAnonymous,
    createdBy: poll.createdBy,
    createdAt: poll.createdAt,
    hasVoted: Array.isArray(poll.votedUsers)
      ? poll.votedUsers.map(u => u.toString()).includes(userId.toString())
      : false,
    totalVotes,
    options: poll.options.map(opt => ({
      text: opt.text,
      _id: opt._id
    }))
  };
};

// ✅ CREATE a new poll
exports.create = async (req, res) => {
  try {
    const { q, opts, exp, multi, anon } = req.body;

    if (!q || !opts || opts.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Question and at least 2 options required'
      });
    }

    const poll = await Poll.create({
      question: q,
      options: opts.map(t => ({ text: t, votes: 0 })),
      expiresAt: exp || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      allowMultiple: multi || false,
      isAnonymous: anon !== false,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Poll created successfully',
      poll: formatPollForUser(poll, req.user.id)
    });
  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create poll'
    });
  }
};

// ✅ LIST all polls (auto-close expired)
exports.list = async (req, res) => {
  try {
    const now = new Date();

    // Auto-update expired polls
    await Poll.updateMany(
      { expiresAt: { $lt: now }, isClosed: false },
      { $set: { isClosed: true } }
    );

    const polls = await Poll.find({}).sort('-createdAt').lean();
    const formattedPolls = polls.map(p => formatPollForUser(p, req.user.id));

    res.json({
      success: true,
      polls: formattedPolls
    });
  } catch (error) {
    console.error('List polls error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch polls',
      polls: []
    });
  }
};


// ✅ VOTE (supports multi-select)
exports.vote = async (req, res) => {
  try {
    const { id } = req.params;
    const opts = Array.isArray(req.body.opts) ? req.body.opts : [req.body.opts];

    const poll = await Poll.findById(id);

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found'
      });
    }

    if (poll.isClosed) {
      return res.status(400).json({
        success: false,
        message: 'Poll is closed'
      });
    }

    if (new Date(poll.expiresAt) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Poll has expired'
      });
    }

    if (poll.votedUsers.map(u => u.toString()).includes(req.user.id.toString())) {
      return res.status(400).json({
        success: false,
        message: 'You have already voted'
      });
    }

    if (!poll.allowMultiple && opts.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'This poll allows only one choice'
      });
    }

    // Validate option indices
    const invalidOpts = opts.filter(i => i < 0 || i >= poll.options.length);
    if (invalidOpts.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid option selected'
      });
    }

    // Increment votes for selected options
    opts.forEach(i => {
      poll.options[i].votes += 1;
    });

    poll.votedUsers.push(req.user.id);
    await poll.save();

    res.json({
      success: true,
      message: 'Vote recorded successfully',
      poll: formatPollForUser(poll, req.user.id)
    });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record vote'
    });
  }
};

// ✅ RESULTS (with chart data)
exports.results = async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id).lean();

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found'
      });
    }

    const total = poll.options.reduce((s, o) => s + o.votes, 0) || 1;

    const chartData = poll.options.map((o, i) => ({
      label: o.text,
      value: o.votes,
      percent: Math.round((o.votes / total) * 100),
      color: `hsl(${(i * 360) / poll.options.length}, 70%, 50%)`
    }));

    res.json({
      success: true,
      poll: {
        ...poll,
        totalVotes: total,
        chartData
      }
    });
  } catch (error) {
    console.error('Results error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch results'
    });
  }
};

// ✅ EDIT poll
exports.edit = async (req, res) => {
  try {
    const poll = await Poll.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user.id },
      req.body,
      { new: true }
    );

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found or unauthorized'
      });
    }

    res.json({
      success: true,
      message: 'Poll updated',
      poll
    });
  } catch (error) {
    console.error('Edit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update poll'
    });
  }
};

// ✅ CLOSE poll
exports.close = async (req, res) => {
  try {
    const poll = await Poll.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user.id },
      { isClosed: true },
      { new: true }
    );

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found or unauthorized'
      });
    }

    res.json({
      success: true,
      message: 'Poll closed successfully',
      poll
    });
  } catch (error) {
    console.error('Close error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close poll'
    });
  }
};

// ✅ DELETE poll
exports.remove = async (req, res) => {
  try {
    const result = await Poll.deleteOne({
      _id: req.params.id,
      createdBy: req.user.id
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found or unauthorized'
      });
    }

    res.json({
      success: true,
      message: 'Poll deleted successfully'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete poll'
    });
  }
};
