// controllers/aboutController.js
const About = require('../models/About');
const TeamMember = require('../models/TeamMember');
const cloudinary = require('cloudinary').v2;
const fs = require('fs').promises; // To delete temp files
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

// ======================
// PUBLIC
// ======================
exports.getAboutInfo = asyncHandler(async (req, res) => {
  const [about, team] = await Promise.all([
    About.findOne(),
    TeamMember.find({ isActive: true }).sort({ order: 1, createdAt: -1 })
  ]);

  // If no About document yet, return empty but valid structure
  if (!about) {
    return res.status(200).json({
      success: true,
      data: {
        companyName: 'Your Company',
        description: '',
        slogan: '',
        mission: '',
        vision: '',
        values: [],
        stats: [],
        timeline: [],
        achievements: [],
        team: team || []
      }
    });
  }

  res.status(200).json({
    success: true,
    data: {
      ...about.toObject(),
      team: team || []
    }
  });
});

// ======================
// ADMIN: MAIN CONTENT
// ======================
exports.createOrUpdateAbout = asyncHandler(async (req, res) => {
  const updatedAbout = await About.findOneAndUpdate(
    {}, // Match the single document
    { ...req.body, updatedAt: Date.now() },
    {
      new: true,
      upsert: true,              // Create if doesn't exist
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );

  res.status(200).json({
    success: true,
    data: updatedAbout
  });
});

// ======================
// TIMELINE CRUD
// ======================
exports.addTimelineItem = asyncHandler(async (req, res) => {
  const about = await About.findOne();
  if (!about) {
    throw new AppError('Create main about content first', 400, {
      code: 'ABOUT_NOT_INITIALIZED',
    });
  }

  about.timeline.push(req.body);
  await about.save();

  const newItem = about.timeline[about.timeline.length - 1];

  res.status(201).json({
    success: true,
    data: newItem
  });
});

exports.updateTimelineItem = asyncHandler(async (req, res) => {
  const about = await About.findOne();
  if (!about) {
    throw new AppError('About content not found', 404, {
      code: 'ABOUT_NOT_FOUND',
    });
  }

  const item = about.timeline.id(req.params.id);
  if (!item) {
    throw new AppError('Timeline item not found', 404, {
      code: 'TIMELINE_ITEM_NOT_FOUND',
    });
  }

  // Update only provided fields
  Object.assign(item, req.body);
  await about.save();

  res.status(200).json({
    success: true,
    data: item
  });
});

exports.deleteTimelineItem = asyncHandler(async (req, res) => {
  const about = await About.findOne();
  if (!about) {
    throw new AppError('About content not found', 404, {
      code: 'ABOUT_NOT_FOUND',
    });
  }

  const item = about.timeline.id(req.params.id);
  if (!item) {
    throw new AppError('Timeline item not found', 404, {
      code: 'TIMELINE_ITEM_NOT_FOUND',
    });
  }

  item.remove();
  await about.save();

  res.status(200).json({
    success: true,
    message: 'Timeline item deleted successfully'
  });
});

// ======================
// STATS CRUD
// ======================
exports.addStatItem = asyncHandler(async (req, res) => {
  const about = await About.findOne();
  if (!about) {
    throw new AppError('Create main about content first', 400, {
      code: 'ABOUT_NOT_INITIALIZED',
    });
  }

  about.stats.push(req.body);
  await about.save();

  const newStat = about.stats[about.stats.length - 1];

  res.status(201).json({
    success: true,
    data: newStat
  });
});

exports.updateStatItem = asyncHandler(async (req, res) => {
  const about = await About.findOne();
  if (!about) {
    throw new AppError('About content not found', 404, {
      code: 'ABOUT_NOT_FOUND',
    });
  }

  const stat = about.stats.id(req.params.id);
  if (!stat) {
    throw new AppError('Stat item not found', 404, {
      code: 'STAT_ITEM_NOT_FOUND',
    });
  }

  Object.assign(stat, req.body);
  await about.save();

  res.status(200).json({
    success: true,
    data: stat
  });
});

exports.deleteStatItem = asyncHandler(async (req, res) => {
  const about = await About.findOne();
  if (!about) {
    throw new AppError('About content not found', 404, {
      code: 'ABOUT_NOT_FOUND',
    });
  }

  const stat = about.stats.id(req.params.id);
  if (!stat) {
    throw new AppError('Stat item not found', 404, {
      code: 'STAT_ITEM_NOT_FOUND',
    });
  }

  stat.remove();
  await about.save();

  res.status(200).json({
    success: true,
    message: 'Stat item deleted successfully'
  });
});

// ======================
// TEAM MEMBERS
// ======================
exports.addTeamMember = asyncHandler(async (req, res) => {
  let imageUrl = req.body.imageUrl || null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'team',
      width: 400,
      height: 400,
      crop: 'fill',
      gravity: 'face' // Better for portraits
    });
    imageUrl = result.secure_url;

    // Delete temp file
    await fs.unlink(req.file.path).catch(() => {});
  }

  const member = await TeamMember.create({
    ...req.body,
    imageUrl
  });

  res.status(201).json({
    success: true,
    data: member
  });
});

exports.updateTeamMember = asyncHandler(async (req, res) => {
  const updates = { ...req.body };

  if (req.file) {
    // Upload new image
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'team',
      width: 400,
      height: 400,
      crop: 'fill',
      gravity: 'face'
    });
    updates.imageUrl = result.secure_url;
    await fs.unlink(req.file.path).catch(() => {});
  }

  const member = await TeamMember.findByIdAndUpdate(
    req.params.id,
    updates,
    { new: true, runValidators: true }
  );

  if (!member) {
    throw new AppError('Team member not found', 404, {
      code: 'TEAM_MEMBER_NOT_FOUND',
    });
  }

  res.status(200).json({
    success: true,
    data: member
  });
});

exports.deleteTeamMember = asyncHandler(async (req, res) => {
  const member = await TeamMember.findById(req.params.id);
  if (!member) {
    throw new AppError('Team member not found', 404, {
      code: 'TEAM_MEMBER_NOT_FOUND',
    });
  }

  // Delete image from Cloudinary if exists
  if (member.imageUrl && member.imageUrl.includes('cloudinary')) {
    const publicId = member.imageUrl.split('/').slice(-2).join('/').split('.')[0]; // team/abc123
    await cloudinary.uploader.destroy(publicId).catch(() => {});
  }

  await member.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Team member deleted successfully'
  });
});