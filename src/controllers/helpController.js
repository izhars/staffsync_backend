const HelpTopic = require('../models/HelpTopic');
const mongoose = require('mongoose');

// Helper: Normalize string
const normalize = (str) => str?.trim();

// GET /api/help - Get all topics (paginated)
exports.getAllTopics = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [topics, total] = await Promise.all([
      HelpTopic.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      HelpTopic.countDocuments()
    ]);

    res.status(200).json({
      success: true,
      data: topics,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message
    });
  }
};

// GET /api/help/:id - Get single topic
exports.getTopicById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid topic ID' });
    }

    const topic = await HelpTopic.findById(id);
    if (!topic) {
      return res.status(404).json({ success: false, error: 'Topic not found' });
    }

    res.status(200).json({ success: true, data: topic });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message
    });
  }
};

// POST /api/help - Create new topic
exports.addTopic = async (req, res) => {
  try {
    console.log('=== Add Topic Attempt ===');
    console.log('Request body:', req.body);

    const { title, icon, description } = req.body;

    // Validation
    if (!title || typeof title !== 'string') {
      console.log('Validation failed: Title missing or not a string');
      return res.status(400).json({ success: false, error: 'Title is required and must be a string' });
    }

    const normalizedTitle = normalize(title);
    if (!normalizedTitle) {
      console.log('Validation failed: Normalized title is empty');
      return res.status(400).json({ success: false, error: 'Title cannot be empty' });
    }

    console.log('Normalized title:', normalizedTitle);

    // Check duplicate
    const exists = await HelpTopic.findOne({ title: normalizedTitle });
    if (exists) {
      console.log('Duplicate topic found:', normalizedTitle);
      return res.status(400).json({ success: false, error: 'A topic with this title already exists' });
    }

    const topic = new HelpTopic({
      title: normalizedTitle,
      icon: normalize(icon),
      description: normalize(description)
    });

    console.log('Saving new topic:', topic);

    await topic.save();
    console.log('Topic saved successfully:', topic._id);

    res.status(201).json({ success: true, data: topic });
  } catch (err) {
    console.error('Error while adding topic:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Topic title must be unique' });
    }
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Failed to create topic' : err.message
    });
  }
};


// PUT /api/help/:id - Update topic
exports.updateTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid topic ID' });
    }

    // Validate title if being updated
    if (updates.title !== undefined) {
      if (typeof updates.title !== 'string') {
        return res.status(400).json({ success: false, error: 'Title must be a string' });
      }
      const normalized = normalize(updates.title);
      if (!normalized) {
        return res.status(400).json({ success: false, error: 'Title cannot be empty' });
      }
      updates.title = normalized;

      // Check for duplicate title (excluding current topic)
      const exists = await HelpTopic.findOne({
        title: updates.title,
        _id: { $ne: id }
      });
      if (exists) {
        return res.status(400).json({ success: false, error: 'Another topic with this title already exists' });
      }
    }

    // Clean other fields
    if (updates.icon !== undefined) updates.icon = normalize(updates.icon);
    if (updates.description !== undefined) updates.description = normalize(updates.description);

    const topic = await HelpTopic.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!topic) {
      return res.status(404).json({ success: false, error: 'Topic not found' });
    }

    res.status(200).json({ success: true, data: topic });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Failed to update topic' : err.message
    });
  }
};

// DELETE /api/help/:id - Delete topic
exports.deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`=== Delete Topic Attempt ===`);
    console.log(`Performed by User: ${req.user?._id} Role: ${req.user?.role}`);
    console.log(`Topic ID to delete: ${id}`);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log(`Invalid topic ID: ${id}`);
      return res.status(400).json({ success: false, error: 'Invalid topic ID' });
    }

    const topic = await HelpTopic.findByIdAndDelete(id);
    if (!topic) {
      console.log(`Topic not found: ${id}`);
      return res.status(404).json({ success: false, error: 'Topic not found' });
    }

    console.log(`Topic deleted successfully: ${id}`);
    res.status(200).json({ success: true, message: 'Topic deleted successfully' });
  } catch (err) {
    console.error(`Error deleting topic: ${err.message}`, err);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Failed to delete topic' : err.message
    });
  }
};
