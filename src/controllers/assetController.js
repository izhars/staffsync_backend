// controllers/assetController.js
const Asset = require('../models/Asset');
const User = require('../models/User');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const {
  notifyAssetAssigned,
  notifyAssetReturned,
  notifyAssetStatusChanged,
} = require('../utils/assetNotifications');

// @desc    Get all assets
// @route   GET /api/assets
// @access  Private (HR, Admin)
exports.getAllAssets = asyncHandler(async (req, res) => {
  const { category, status, assignedTo } = req.query;
  const query = {};
  if (category) query.category = category;
  if (status) query.status = status;
  if (assignedTo) query.assignedTo = assignedTo;

  const assets = await Asset.find(query)
    .populate('assignedTo', 'firstName lastName employeeId email')
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: assets.length, assets });
});

// @desc    Get my assets
// @route   GET /api/assets/my-assets
// @access  Private
exports.getMyAssets = asyncHandler(async (req, res) => {
  const assets = await Asset.find({ assignedTo: req.user.id, status: 'assigned' });
  res.status(200).json({ success: true, count: assets.length, assets });
});

// @desc    Get single asset
// @route   GET /api/assets/:id
// @access  Private
exports.getAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id)
    .populate('assignedTo', 'firstName lastName employeeId email profilePicture')
    .populate('assignmentHistory.employee', 'firstName lastName employeeId');

  if (!asset) {
    throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
  }

  res.status(200).json({ success: true, asset });
});

// @desc    Create asset
// @route   POST /api/assets
// @access  Private (HR, Admin)
exports.createAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.create(req.body);
  res.status(201).json({
    success: true,
    message: 'Asset created successfully',
    asset,
  });
});

// @desc    Update asset
// @route   PUT /api/assets/:id
// @access  Private (HR, Admin)
exports.updateAsset = asyncHandler(async (req, res) => {
  const asset = await Asset.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  if (!asset) {
    throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
  }

  res.status(200).json({
    success: true,
    message: 'Asset updated successfully',
    asset,
  });
});

// @desc    Assign asset to employee
// @route   PUT /api/assets/:id/assign
// @access  Private (HR, Admin)
exports.assignAsset = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;

  const asset = await Asset.findById(req.params.id);
  if (!asset) {
    throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
  }
  if (asset.status === 'assigned') {
    throw new AppError('Asset is already assigned', 400, {
      code: 'ASSET_ALREADY_ASSIGNED',
    });
  }

  const employee = await User.findById(employeeId);
  if (!employee) {
    throw new AppError('Employee not found', 404, { code: 'EMPLOYEE_NOT_FOUND' });
  }

  asset.assignedTo = employeeId;
  asset.assignedDate = Date.now();
  asset.status = 'assigned';
  await asset.save();
  await asset.populate('assignedTo', 'firstName lastName employeeId email');
  await notifyAssetAssigned(asset.assignedTo._id, asset);

  res.status(200).json({
    success: true,
    message: 'Asset assigned successfully',
    asset,
  });
});

// @desc    Return asset from employee
// @route   PUT /api/assets/:id/return
// @access  Private (HR, Admin)
exports.returnAsset = asyncHandler(async (req, res) => {
  const { condition, remarks } = req.body;

  const asset = await Asset.findById(req.params.id);
  if (!asset) {
    throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
  }
  if (asset.status !== 'assigned') {
    throw new AppError('Asset is not assigned', 400, {
      code: 'ASSET_NOT_ASSIGNED',
    });
  }

  asset.assignmentHistory.push({
    employee: asset.assignedTo,
    assignedDate: asset.assignedDate,
    returnedDate: Date.now(),
    condition: condition || asset.condition,
    remarks,
  });
  await asset.save();

  asset.assignedTo = undefined;
  asset.assignedDate = undefined;
  asset.status = 'available';
  asset.condition = condition || asset.condition;
  await asset.save();

  await notifyAssetReturned(asset.assignmentHistory.slice(-1)[0].employee, asset);

  res.status(200).json({
    success: true,
    message: 'Asset returned successfully',
    asset,
  });
});

// @desc    Delete asset
// @route   DELETE /api/assets/:id
// @access  Private (Admin only)
exports.deleteAsset = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const asset = await Asset.findById(id);

  if (!asset) {
    throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
  }

  if (asset.status === 'assigned') {
    throw new AppError('Cannot delete assigned asset', 400, {
      code: 'ASSET_ASSIGNED_CANNOT_DELETE',
    });
  }

  await Asset.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Asset deleted successfully',
  });
});

// @desc    Change asset status (maintenance, retired, available, etc.)
// @route   PUT /api/assets/:id/status
// @access  Private (HR, Admin)
exports.changeAssetStatus = asyncHandler(async (req, res) => {
  const { status, remarks } = req.body;

  const validStatuses = ['available', 'assigned', 'under-maintenance', 'retired'];
  if (!validStatuses.includes(status)) {
    throw new AppError('Invalid status value', 400, {
      code: 'INVALID_STATUS',
      details: { validStatuses },
    });
  }

  const asset = await Asset.findById(req.params.id);
  if (!asset) {
    throw new AppError('Asset not found', 404, { code: 'ASSET_NOT_FOUND' });
  }

  if (asset.status === 'assigned' && status !== 'assigned') {
    throw new AppError(
      'Cannot change status of an assigned asset. Return it first.',
      400,
      { code: 'ASSET_ASSIGNED_STATUS_LOCKED' }
    );
  }

  asset.status = status;
  if (remarks) asset.remarks = remarks;

  await asset.save();

  if (asset.assignedTo) {
    await notifyAssetStatusChanged(asset.assignedTo, asset);
  }

  res.status(200).json({
    success: true,
    message: `Asset status updated to '${status}'`,
    asset,
  });
});