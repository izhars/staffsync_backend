// controllers/announcementController.js
const Announcement = require('../models/Announcement');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const { notifyAnnouncementToAudience } = require('../utils/announcementNotifications');

// @desc    Get all announcements
// @route   GET /api/announcements
// @access  Private
exports.getAllAnnouncements = asyncHandler(async (req, res) => {
  const { type, priority } = req.query;

  const query = { isActive: true };

  if (type) query.type = type;
  if (priority) query.priority = priority;

  query.$or = [
    { 'targetAudience.type': 'all' },
    { 'targetAudience.employees': req.user.id },
    { 'targetAudience.departments': req.user.department }
  ];

  const announcements = await Announcement.find(query)
    .populate('createdBy', 'firstName lastName email profilePicture')
    .sort({ priority: -1, publishDate: -1 });

  res.status(200).json({
    success: true,
    count: announcements.length,
    announcements
  });
});

// @desc    Get single announcement
// @route   GET /api/announcements/:id
// @access  Private
exports.getAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findById(req.params.id)
    .populate('createdBy', 'firstName lastName email profilePicture')
    .populate('targetAudience.departments', 'name')
    .populate('targetAudience.employees', 'firstName lastName email');

  if (!announcement) {
    throw new AppError('Announcement not found', 404, {
      code: 'ANNOUNCEMENT_NOT_FOUND',
    });
  }

  const hasRead = announcement.readBy.some(
    r => r.user.toString() === req.user.id
  );

  if (!hasRead) {
    announcement.readBy.push({ user: req.user.id });
    await announcement.save();
  }

  res.status(200).json({ success: true, announcement });
});

// @desc    Create announcement
// @route   POST /api/announcements
// @access  Private (HR, Admin)
exports.createAnnouncement = asyncHandler(async (req, res) => {
  const announcementData = { ...req.body, createdBy: req.user.id };

  const announcement = await Announcement.create(announcementData);
  await announcement.populate('createdBy', 'firstName lastName email');
  await notifyAnnouncementToAudience(announcement);

  res.status(201).json({
    success: true,
    message: 'Announcement created successfully',
    announcement
  });
});

// @desc    Update announcement
// @route   PUT /api/announcements/:id
// @access  Private (HR, Admin)
exports.updateAnnouncement = asyncHandler(async (req, res) => {
  let announcement = await Announcement.findById(req.params.id);
  if (!announcement) {
    throw new AppError('Announcement not found', 404, {
      code: 'ANNOUNCEMENT_NOT_FOUND',
    });
  }

  announcement = await Announcement.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  ).populate('createdBy');

  res.status(200).json({
    success: true,
    message: 'Announcement updated successfully',
    announcement
  });
});

// @desc    Delete announcement
// @route   DELETE /api/announcements/:id
// @access  Private (HR, Admin)
exports.deleteAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findById(req.params.id);
  if (!announcement) {
    throw new AppError('Announcement not found', 404, {
      code: 'ANNOUNCEMENT_NOT_FOUND',
    });
  }

  // Soft delete
  announcement.isActive = false;
  await announcement.save();

  res.status(200).json({
    success: true,
    message: 'Announcement deleted successfully'
  });
});