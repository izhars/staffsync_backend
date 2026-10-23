const Award = require('../models/Award');
const User = require('../models/User');
const AppError = require('../utils/appError');

// @desc      Create new award
// @route     POST /api/v1/awards
// @access    Private (HR & above)
// controllers/awardController.js  — createAward tweak
exports.createAward = async (req, res, next) => {
  try {
    const { name, description, awardedTo, badge, badgeUrl } = req.body;

    const recipient = await User.findById(awardedTo);
    if (!recipient) return next(new AppError('Recipient user not found', 404));

    // If badge ObjectId was provided, validate it exists
    if (badge) {
      const Badge = require('../models/Badge');
      const badgeDoc = await Badge.findById(badge);
      if (!badgeDoc) return next(new AppError('Badge not found', 404));
    }

    const award = await Award.create({
      name,
      description,
      awardedTo,
      awardedBy: req.user.id,
      badge,         // 👈 new field (preferred)
      badgeUrl,      // 👈 optional override / legacy
    });

    // Push badge to user's badge list
    if (badge) {
      const alreadyHas = recipient.badges?.some(
        (b) => b.badge?.toString() === badge.toString()
      );
      if (!alreadyHas) {
        recipient.badges = recipient.badges || [];
        recipient.badges.push({
          badge,
          award: award._id,
          awardedBy: req.user.id,
          dateEarned: new Date(),
        });
        await recipient.save();
      }
    }

    const populated = await Award.findById(award._id);

    res.status(201).json({
      success: true,
      message: 'Award created and badge assigned',
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// @desc      Get all awards
// @route     GET /api/v1/awards
// @access    Private (HR & above)
exports.getAwards = async (req, res, next) => {
  try {
    let query = {};

    if (req.query.awardedTo) {
      query.awardedTo = req.query.awardedTo;
    }

    if (req.query.startDate || req.query.endDate) {
      query.dateAwarded = {};
      if (req.query.startDate) query.dateAwarded.$gte = req.query.startDate;
      if (req.query.endDate) query.dateAwarded.$lte = req.query.endDate;
    }

    const awards = await Award.find(query).sort('-dateAwarded');

    res.status(200).json({
      success: true,
      count: awards.length,
      data: awards,
    });
  } catch (error) {
    next(error);
  }
};

// @desc      Get single award
// @route     GET /api/v1/awards/:id
// @access    Private (HR & above)
exports.getAward = async (req, res, next) => {
  try {
    const award = await Award.findById(req.params.id);

    if (!award) {
      return next(new AppError(`Award not found with id: ${req.params.id}`, 404));
    }

    res.status(200).json({
      success: true,
      data: award,
    });
  } catch (error) {
    next(error);
  }
};

// @desc      Update award
// @route     PUT /api/v1/awards/:id
// @access    Private (HR & above)
exports.updateAward = async (req, res, next) => {
  try {
    let award = await Award.findById(req.params.id);

    if (!award) {
      return next(new AppError(`Award not found with id: ${req.params.id}`, 404));
    }

    const allowedFields = ['name', 'description', 'badgeUrl', 'isActive'];
    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    award = await Award.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      data: award,
    });
  } catch (error) {
    next(error);
  }
};

// @desc      Delete award
// @route     DELETE /api/v1/awards/:id
// @access    Private (Superadmin only)
exports.deleteAward = async (req, res, next) => {
  try {
    const award = await Award.findById(req.params.id);

    if (!award) {
      return next(new AppError(`Award not found with id: ${req.params.id}`, 404));
    }

    await award.remove();

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

// @desc      Get awards for current user (employee view)
// @route     GET /api/v1/awards/me
// @access    Private
exports.getMyAwards = async (req, res, next) => {
  try {
    const awards = await Award.find({ awardedTo: req.user.id }).sort('-dateAwarded');

    res.status(200).json({
      success: true,
      count: awards.length,
      data: awards,
    });
  } catch (error) {
    next(error);
  }
};
