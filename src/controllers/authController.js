// controllers/authController.js
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const Department = require('../models/Department');
const Shift = require('../models/Shift');
const ProfileLog = require('../models/ProfileLog');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const emailService = require('../services/emailService');
const { generateForgotPasswordEmail } = require('../email/forgotPasswordEmail');
const { uploadToCloudinary, deleteFromCloudinary } = require('../middleware/upload');
const { ACCESS_ROLES, ROLE_CREATION_MATRIX, ADMIN_ROLES } = require('../constants/roles');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const { notifySecurityEvent } = require('../utils/securityNotifications');
const {
  notifyPasswordChanged,
  notifyDeviceReset,
  notifyVerificationChanged,
  recordSecurityEvent,
} = require('../utils/securityNotifications');

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:7000';

/**
 * Remember an FCM token for this user without dropping other devices.
 * Keeps the most recent tokens (bounded) and de-duplicates.
 */
const rememberFcmToken = (user, token, { replaceOthers = false } = {}) => {
  if (!token) return;
  const existing = Array.isArray(user.fcmToken) ? user.fcmToken : [];
  const next = replaceOthers ? [token] : [...existing, token];
  user.fcmToken = [...new Set(next)].slice(-10);
};

/** Forget a token (e.g. on logout) so the device stops receiving push. */
const forgetFcmToken = (user, token) => {
  if (!token) return;
  const existing = Array.isArray(user.fcmToken) ? user.fcmToken : [];
  user.fcmToken = existing.filter((t) => t !== token);
};

// ────────────────────────────────────────────────────────────────
// JWT helper
// ────────────────────────────────────────────────────────────────
const generateToken = (id, role, employeeId, sessionId = null) => {
  if (!process.env.JWT_SECRET) {
    throw new AppError('JWT_SECRET is not configured', 500, {
      code: 'JWT_MISCONFIGURED',
    });
  }
  return jwt.sign(
    { id, role, employeeId, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
};

// ────────────────────────────────────────────────────────────────
// @desc    Register new user
// @route   POST /api/auth/register
// @access  Private (Superadmin, HR Admin, Manager)
// ────────────────────────────────────────────────────────────────
exports.register = asyncHandler(async (req, res) => {
  const {
    employeeId, email, password, firstName, lastName,
    role: requestedRole,
    department,
    designation,
    shift,
    dateOfJoining, employmentType,
    reportingManager, salary, bankDetails, phone, gender,
    dateOfBirth, maritalStatus, marriageAnniversary,
    spouseDetails, bloodGroup, address, emergencyContact,
    panNumber, pfNumber, uanNumber, documents, profilePicture,
    weekendType,
  } = req.body;

  // ── 1. Required field validation ─────────────────────────────
  if (!employeeId || !email || !password || !firstName || !lastName
    || !department || !designation) {
    throw new AppError(
      'Employee ID, email, password, names, department, and designation are required',
      400,
      { code: 'MISSING_FIELDS' }
    );
  }

  // ── 2. Role permission check ─────────────────────────────────
  const creatorRole = req.user?.role;
  const assignedRole = requestedRole || ACCESS_ROLES.EMPLOYEE;
  const allowed = ROLE_CREATION_MATRIX[creatorRole] || [];

  if (!allowed.includes(assignedRole)) {
    throw new AppError(
      `${creatorRole} can only create: ${allowed.join(', ') || 'none'}`,
      403,
      { code: 'ROLE_NOT_ALLOWED' }
    );
  }

  // ── 3. Duplicate check ───────────────────────────────────────
  const existingUser = await User.findOne({ $or: [{ email }, { employeeId }] });
  if (existingUser) {
    throw new AppError(
      existingUser.email === email ? 'Email already registered' : 'Employee ID already exists',
      400,
      { code: 'DUPLICATE_USER' }
    );
  }

  // ── 4. Resolve / auto-create Department ──────────────────────
  let deptDoc;
  if (mongoose.Types.ObjectId.isValid(department)) {
    deptDoc = await Department.findById(department);
  } else {
    deptDoc = await Department.findOne({
      name: { $regex: new RegExp(`^${department.trim()}$`, 'i') },
    });
  }

  if (!deptDoc) {
    const code = department
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 4);

    deptDoc = await Department.create({
      name: department.trim().toUpperCase(),
      code,
      head: req.user._id,
    });
  }

  // ── 5. Managers may only hire into their own department ──────
  if (creatorRole === ACCESS_ROLES.MANAGER
    && String(deptDoc._id) !== String(req.user.department)) {
    throw new AppError(
      'Managers can only create users within their own department',
      403,
      { code: 'DEPARTMENT_MISMATCH' }
    );
  }

  // ── 6. Reporting manager resolution ──────────────────────────
  let reportingManagerId = null;
  if (reportingManager && !['NA', ''].includes(String(reportingManager).trim())) {
    const trimmed = String(reportingManager).trim();
    const managerQuery = mongoose.Types.ObjectId.isValid(trimmed)
      ? { _id: trimmed }
      : { employeeId: trimmed.toUpperCase() };

    const manager = await User.findOne({
      ...managerQuery,
      isActive: true,
      role: {
        $in: [
          ACCESS_ROLES.SUPER_ADMIN,
          ACCESS_ROLES.HR_ADMIN,
          ACCESS_ROLES.MANAGER,
          ACCESS_ROLES.TEAM_LEAD,
        ],
      },
    });
    if (manager) reportingManagerId = manager._id;
  }

  // ── 7. Resolve & validate Shift ──────────────────────────────
  let shiftId = null;
  if (shift && mongoose.Types.ObjectId.isValid(shift)) {
    const shiftDoc = await Shift.findOne({ _id: shift, isActive: true });
    if (!shiftDoc) {
      throw new AppError('Invalid or inactive shift', 400, {
        code: 'INVALID_SHIFT',
      });
    }
    shiftId = shiftDoc._id;
  }

  // ── 8. Probation window ──────────────────────────────────────
  const probationStart = dateOfJoining ? new Date(dateOfJoining) : new Date();
  const probationEnd = new Date(probationStart);
  probationEnd.setMonth(probationEnd.getMonth() + 6);

  // ── 9. Build user payload ────────────────────────────────────
  const userData = {
    employeeId: employeeId.trim().toUpperCase(),
    email: email.toLowerCase().trim(),
    password,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    role: assignedRole,
    department: deptDoc._id,
    designation: designation.trim(),
    dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : new Date(),
    employmentType: employmentType || 'full-time',
    reportingManager: reportingManagerId,
    salary: salary || {
      basic: 0, hra: 0, medicalConveyance: 0,
      conveyanceAllowance: 0, specialAllowance: 0,
      employerEPF: 0, employeeEPF: 0,
      gratuity: 0, benevolentFund: 0,
    },
    bankDetails: bankDetails || {},
    phone: phone ? phone.trim() : '',
    gender,
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    maritalStatus: maritalStatus || 'single',
    marriageAnniversary: maritalStatus === 'married' ? marriageAnniversary : undefined,
    spouseDetails: maritalStatus === 'married' ? (spouseDetails || {}) : {},
    bloodGroup: bloodGroup || null,
    address: {
      street: address?.street || '',
      city: address?.city || '',
      state: address?.state || '',
      country: address?.country || 'India',
      postalCode: address?.postalCode || '',
    },
    emergencyContact: emergencyContact || {},
    panNumber: panNumber ? panNumber.toUpperCase().trim() : '',
    pfNumber: pfNumber ? pfNumber.trim() : '',
    uanNumber: uanNumber ? uanNumber.trim() : '',
    documents: documents || [],
    profilePicture: profilePicture || '',
    createdBy: req.user._id,
    isVerified: creatorRole === ACCESS_ROLES.SUPER_ADMIN,
    weekendType: weekendType || 'sunday',
    probationStartDate: probationStart,
    probationEndDate: probationEnd,
    isProbationCompleted: false,
    leaveBalance: { casual: 0, sick: 0, earned: 0, unpaid: 0 },
    shift: shiftId,
    shiftAssignedAt: shiftId ? new Date() : null,
    shiftAssignedBy: shiftId ? req.user._id : null,
  };

  const user = new User(userData);
  await user.save();

  // ── 10. Welcome email (non-blocking) ────────────────────────
  try {
    if ([ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.SUPER_ADMIN].includes(creatorRole)) {
      await emailService.sendWelcomeEmail(user, password);
    }
  } catch (emailError) {
    console.error('Failed to send welcome email:', emailError);
  }

  // ── 11. Salary calculation ──────────────────────────────────
  try {
    if (typeof user.calculateNetSalary === 'function') {
      user.calculateNetSalary();
      await user.save();
    }
  } catch (salaryError) {
    console.error('Salary calculation error:', salaryError);
  }

  // ── 12. Generate token ──────────────────────────────────────
  const token = generateToken(user._id, user.role, user.employeeId);

  // ── 13. Populate for response ───────────────────────────────
  const populatedUser = await User.findById(user._id)
    .populate('department', 'name')
    .populate('reportingManager', 'firstName lastName employeeId')
    .populate('shift', 'name code startTime endTime')
    .lean();

  // ── 14. Send response ───────────────────────────────────────
  res.status(201).json({
    success: true,
    message: `${assignedRole} account created successfully`,
    token,
    user: {
      id: user._id,
      employeeId: user.employeeId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      department: populatedUser.department?.name,
      designation: user.designation,
      shift: populatedUser.shift
        ? {
          id: populatedUser.shift._id,
          name: populatedUser.shift.name,
          code: populatedUser.shift.code,
          startTime: populatedUser.shift.startTime,
          endTime: populatedUser.shift.endTime,
        }
        : null,
      shiftAssignedAt: user.shiftAssignedAt,
      shiftAssignedBy: user.shiftAssignedBy,
      employmentType: user.employmentType,
      reportingManager: populatedUser.reportingManager
        ? `${populatedUser.reportingManager.firstName} ${populatedUser.reportingManager.lastName} (${populatedUser.reportingManager.employeeId})`
        : null,
      phone: user.phone,
      profilePicture: user.profilePicture,
      dateOfJoining: user.dateOfJoining,
      salary: user.salary?.netSalary || 0,
      isActive: user.isActive,
      weekendType: user.weekendType,
    },
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
// ────────────────────────────────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const { identifier, email, employeeId, password, deviceId, fcmToken } = req.body;

  // Accept either `identifier`, `email`, or `employeeId` from the client
  const loginId = identifier || email || employeeId;
  const loginMethod = identifier ? 'identifier' : (email ? 'email' : (employeeId ? 'employeeId' : 'none'));

  console.log('═══════════════════════════════════════════════════════');
  console.log(`🔐 [LOGIN] Attempt started`);
  console.log(`   ├─ Login ID   : ${loginId || 'unknown'}`);
  console.log(`   ├─ Method     : ${loginMethod}`);
  console.log(`   ├─ IP         : ${req.ip}`);
  console.log(`   ├─ User-Agent : ${req.headers['user-agent'] || 'unknown'}`);
  console.log(`   ├─ Device ID  : ${deviceId || 'not provided'}`);
  console.log(`   ├─ FCM Token  : ${fcmToken ? `${fcmToken.substring(0, 20)}...` : 'not provided'}`);
  console.log(`   └─ Time       : ${new Date().toISOString()}`);

  // ── 1. Credential presence check ──────────────────────────────
  if (!loginId || !password) {
    console.log(`⚠️ [LOGIN] Failed - missing credentials`);
    console.log(`   ├─ loginId present  : ${!!loginId}`);
    console.log(`   └─ password present : ${!!password}`);
    throw new AppError('Please provide your email/employee ID and password', 400, {
      code: 'MISSING_CREDENTIALS',
    });
  }

  // ── 2. User lookup ────────────────────────────────────────────
  console.log(`🔎 [LOGIN] Looking up user...`);
  const lookupStart = Date.now();
  const { user, error } = await User.findForLogin(loginId);
  console.log(`🔎 [LOGIN] Lookup completed in ${Date.now() - lookupStart}ms`);

  if (error === 'ADMIN_MUST_USE_EMAIL') {
    console.log(`🚫 [LOGIN] Admin tried to log in via employeeId: ${loginId}`);
    throw new AppError('Admins must log in using their email address.', 401, {
      code: 'ADMIN_MUST_USE_EMAIL',
    });
  }

  if (error === 'EMPLOYEE_MUST_USE_EMPLOYEE_ID') {
    console.log(`🚫 [LOGIN] Employee tried to log in via email: ${loginId}`);
    throw new AppError('Employees must log in using their Employee ID.', 401, {
      code: 'EMPLOYEE_MUST_USE_EMPLOYEE_ID',
    });
  }

  if (!user) {
    console.log(`❌ [LOGIN] User not found: ${loginId}`);
    throw new AppError('Invalid credentials', 401, {
      code: 'INVALID_CREDENTIALS',
    });
  }

  console.log(`👤 [LOGIN] User record found`);
  console.log(`   ├─ Employee ID : ${user.employeeId}`);
  console.log(`   ├─ Name        : ${user.firstName} ${user.lastName}`);
  console.log(`   ├─ Role        : ${user.role}`);
  console.log(`   ├─ Active      : ${user.isActive}`);
  console.log(`   ├─ Verified    : ${user.isVerified}`);
  console.log(`   ├─ Bound Device: ${user.deviceId || 'none'}`);
  console.log(`   └─ Last Login  : ${user.lastLogin ? user.lastLogin.toISOString() : 'never'}`);

  // ── 3. Password check ─────────────────────────────────────────
  console.log(`🔑 [LOGIN] Verifying password...`);
  const passwordMatch = await user.matchPassword(password);
  if (!passwordMatch) {
    console.log(`❌ [LOGIN] Invalid password for: ${user.employeeId}`);
    console.log(`   ├─ User       : ${user.employeeId} | ${user.role}`);
    console.log(`   ├─ IP         : ${req.ip}`);
    console.log(`   └─ Time       : ${new Date().toISOString()}`);
    throw new AppError('Invalid credentials', 401, {
      code: 'INVALID_CREDENTIALS',
    });
  }
  console.log(`✅ [LOGIN] Password verified for: ${user.employeeId}`);

  // ── 4. Account status checks ──────────────────────────────────
  if (!user.isActive) {
    console.log(`🚫 [LOGIN] Blocked - inactive account: ${user.employeeId}`);
    console.log(`   ├─ Status     : ${user.status}`);
    console.log(`   └─ isActive   : ${user.isActive}`);
    throw new AppError('Account is deactivated. Please contact HR.', 403, {
      code: 'ACCOUNT_DEACTIVATED',
    });
  }

  if (!user.isVerified) {
    console.log(`🚫 [LOGIN] Blocked - unverified account: ${user.employeeId}`);
    throw new AppError(
      'Account is not verified. Please verify your account before logging in.',
      403,
      { code: 'ACCOUNT_UNVERIFIED' }
    );
  }

  // ── 5. Device binding check ───────────────────────────────────
  if (user.deviceId && deviceId && user.deviceId !== deviceId) {
    console.log(`📱 [LOGIN] Device mismatch for: ${user.employeeId}`);
    console.log(`   ├─ Bound device    : ${user.deviceId}`);
    console.log(`   ├─ Request device  : ${deviceId}`);
    console.log(`   └─ IP              : ${req.ip}`);
    throw new AppError(
      'This account is bound to another device. Please contact HR to reset your device.',
      403,
      { code: 'DEVICE_MISMATCH' }
    );
  }

  if (!user.deviceId && deviceId) {
    console.log(`📱 [LOGIN] First-time device binding for: ${user.employeeId}`);
    console.log(`   └─ New device : ${deviceId}`);
  }

  // ── 6. Session management ─────────────────────────────────────
  const sessionId = crypto.randomUUID();
  const previousSessionId = user.currentSessionId;
  const isReplacingSession = !!(previousSessionId && previousSessionId !== sessionId);

  console.log(`🔄 [LOGIN] Creating session`);
  console.log(`   ├─ New session ID      : ${sessionId}`);
  console.log(`   ├─ Previous session ID : ${previousSessionId || 'none'}`);
  console.log(`   └─ Replacing session   : ${isReplacingSession ? 'YES' : 'NO'}`);

  user.currentSessionId = sessionId;
  user.currentSessionDeviceId = deviceId || null;
  user.sessionStartedAt = new Date();

  // Detect a genuinely new device before we overwrite the stored one.
  const isNewDevice = !!deviceId && !!user.deviceId && user.deviceId !== deviceId;

  if (deviceId) user.deviceId = deviceId;
  rememberFcmToken(user, fcmToken);

  user.lastLogin = new Date();
  user.lastLoginDevice = deviceId || null;
  user.lastLoginIp = req.ip;
  user.lastLoginUserAgent = req.headers['user-agent'] || null;

  await user.save({ validateBeforeSave: false });

  console.log(`💾 [LOGIN] User record updated`);
  console.log(`   ├─ Last login        : ${user.lastLogin.toISOString()}`);
  console.log(`   ├─ Last login device : ${user.lastLoginDevice || 'unknown'}`);
  console.log(`   └─ FCM token stored  : ${fcmToken ? 'YES' : 'NO'}`);

  // ── 7. Token generation ───────────────────────────────────────
  const token = generateToken(user._id, user.role, user.employeeId, sessionId);
  console.log(`🎟️  [LOGIN] JWT generated (length: ${token.length} chars)`);

  // ── 7b. Security notice for a new device (non-blocking) ───────
  if (isNewDevice) {
    notifySecurityEvent({
      userId: user._id,
      title: '🔐 New Device Login',
      body: `Your account was signed in from a new device. If this wasn't you, contact HR immediately.`,
      action: 'new_device_login',
      extra: {
        deviceId: deviceId || '',
        ip: req.ip || '',
        userAgent: (req.headers['user-agent'] || '').slice(0, 200),
      },
    });
  }

  console.log(`✅ [LOGIN] SUCCESS`);
  console.log(`   ├─ User       : ${user.employeeId} | ${user.role}`);
  console.log(`   ├─ Full name  : ${user.fullName}`);
  console.log(`   ├─ Session    : ${sessionId}`);
  console.log(`   └─ Time       : ${new Date().toISOString()}`);

  // ── 8. Real-time kick of previous session ─────────────────────
  if (req.io && isReplacingSession) {
    console.log(`🔄 [LOGIN] Emitting force-logout to previous session`);
    console.log(`   ├─ Room     : user:${user._id}`);
    console.log(`   ├─ Old SID  : ${previousSessionId}`);
    console.log(`   └─ New SID  : ${sessionId}`);
    req.io.to(`user:${user._id}`).emit('force-logout', {
      reason: 'Logged in from another device',
      code: 'SESSION_REPLACED',
    });
  } else if (!req.io && isReplacingSession) {
    console.log(`⚠️ [LOGIN] Session replaced but socket.io not available - no force-logout emitted`);
  }

  console.log('═══════════════════════════════════════════════════════');

  res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    user: {
      id: user._id,
      employeeId: user.employeeId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      weekendType: user.weekendType,
      department: user.department?.name,
      designation: user.designation,
      phone: user.phone,
      profilePicture: user.profilePicture,
      isActive: user.isActive,
      isVerified: user.isVerified,
      deviceId: user.deviceId,
      shift: user.shift
        ? {
          id: user.shift._id,
          name: user.shift.name,
          code: user.shift.code,
          startTime: user.shift.startTime,
          endTime: user.shift.endTime,
          timing: `${user.shift.startTime} - ${user.shift.endTime}`,
          workingDays: user.shift.workingDays,
          weekendDays: user.shift.weekendDays,
          type: user.shift.type,
          isNightShift: user.shift.isNightShift,
        }
        : null,
    },
  });
});
// ────────────────────────────────────────────────────────────────
// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id)
    .populate('department', 'name code description')
    .populate('shift', 'name code startTime endTime workingDays weekendDays type isNightShift breakDuration gracePeriod')
    .populate(
      'reportingManager',
      'employeeId firstName lastName email profilePicture role designation department'
    )
    .populate('createdBy', 'firstName lastName');

  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  res.status(200).json({ success: true, user });
});

// ────────────────────────────────────────────────────────────────
// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.updateProfile = asyncHandler(async (req, res) => {
  const forbiddenFields = [
    'role',
    'isActive',
    'isVerified',
    'employeeId',
    'email',
    'createdBy',
    'department',
    'probationStartDate',
    'probationEndDate',
    'isProbationCompleted',
    'leaveBalance',
    'designation',
    'weekendType',
    'shift',
    'shiftAssignedAt',
    'shiftAssignedBy',
  ];

  const updates = { ...req.body };
  forbiddenFields.forEach((field) => delete updates[field]);

  if ('maritalStatus' in updates) {
    if (updates.maritalStatus === 'married') {
      if (!updates.marriageAnniversary) {
        throw new AppError(
          'Marriage anniversary date is required for married status',
          400,
          { code: 'MISSING_ANNIVERSARY' }
        );
      }
      updates.spouseDetails = updates.spouseDetails || {};
    } else {
      updates.marriageAnniversary = undefined;
      updates.spouseDetails = {};
    }
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  const oldData = user.toObject();
  Object.assign(user, updates);

  if (req.body.salary && typeof user.calculateNetSalary === 'function') {
    Object.assign(user.salary, req.body.salary);
    user.calculateNetSalary();
  }

  await user.save();

  const changedFields = {};
  Object.keys(updates).forEach((key) => {
    if (JSON.stringify(oldData[key]) !== JSON.stringify(updates[key])) {
      changedFields[key] = { before: oldData[key], after: updates[key] };
    }
  });

  if (Object.keys(changedFields).length > 0) {
    await ProfileLog.create({
      user: user._id,
      changedBy: req.user.id,
      changes: changedFields,
      updatedAt: new Date(),
    });
  }

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: { ...user.toObject(), daysToAnniversary: user.daysToAnniversary },
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Update profile picture
// @route   PUT /api/auth/profile-picture
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.updateProfilePicture = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400, { code: 'NO_FILE' });
  }
  if (!req.file.mimetype.startsWith('image/')) {
    throw new AppError('Only image files are allowed', 400, {
      code: 'INVALID_FILE_TYPE',
    });
  }

  const result = await uploadToCloudinary(req.file.buffer, 'profile');
  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  if (user.profilePicturePublicId) {
    await deleteFromCloudinary(user.profilePicturePublicId);
  }

  user.profilePicture = result.url;
  user.profilePicturePublicId = result.publicId;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Profile picture updated successfully',
    profilePicture: user.profilePicture,
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new password required', 400, {
      code: 'MISSING_PASSWORDS',
    });
  }
  if (newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters', 400, {
      code: 'WEAK_PASSWORD',
    });
  }

  const user = await User.findById(req.user.id).select('+password');
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }
  if (!(await user.matchPassword(currentPassword))) {
    throw new AppError('Current password is incorrect', 401, {
      code: 'INVALID_CURRENT_PASSWORD',
    });
  }

  user.password = newPassword;
  await user.save();

  await notifyPasswordChanged(user._id, { via: 'change-password' });

  res.status(200).json({ success: true, message: 'Password changed successfully' });
});

// ────────────────────────────────────────────────────────────────
// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
// ────────────────────────────────────────────────────────────────
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    throw new AppError('Email required', 400, { code: 'MISSING_EMAIL' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+resetPasswordToken +resetPasswordExpire');

  // Security: don't reveal if email exists
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If that email exists, a reset link has been sent.',
    });
  }

  // ⚠️ Confirm getResetPasswordToken() exists in User model
  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  // ⚠️ FIXED: frontendUrl now uses port 3000 (defined at top of file)
  const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

  // 🔍 DEBUG — remove after testing
  console.log('📧 [FORGOT PASSWORD]');
  console.log('   Email       :', user.email);
  console.log('   frontendUrl :', frontendUrl);
  console.log('   Reset URL   :', resetUrl);

  const html = generateForgotPasswordEmail(resetUrl);

  try {
    await emailService.sendEmail({
      to: user.email,
      subject: 'HRMS Password Reset',
      html,
    });
  } catch (err) {
    console.error('📧 [FORGOT PASSWORD] Email send failed:', err);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
    throw new AppError('Email could not be sent', 500, {
      code: 'EMAIL_SEND_FAILED',
    });
  }

  res.status(200).json({ success: true, message: 'Password reset email sent' });
});

// ────────────────────────────────────────────────────────────────
// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
// ────────────────────────────────────────────────────────────────
exports.resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // ── 1. Validate password ────────────────────────────────
  if (!password || password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400, {
      code: 'WEAK_PASSWORD',
    });
  }

  // ── 2. Hash the incoming RAW token to match the DB ──────
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // ── 3. Find user with valid (non-expired) hashed token ──
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+password');

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400, {
      code: 'INVALID_RESET_TOKEN',
    });
  }

  // ── 4. Update password (pre-save hook hashes it) ────────
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  // ── 5. Notify (optional, non-blocking) ──────────────────
  // try {
  //   await notifyPasswordChanged(user._id, { via: 'reset-password' });
  // } catch (err) {
  //   console.error('Reset-password notification failed:', err);
  // }

  res.status(200).json({
    success: true,
    message: 'Password reset successful',
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Reset device ID (HR Admin / Superadmin only)
// @route   PATCH /api/users/:userId/reset-device
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.resetDevice = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) {
    throw new AppError('Not authorized', 403, { code: 'NOT_AUTHORIZED' });
  }

  const user = await User.findById(req.params.userId);
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  user.deviceId = null;
  user.lastLoginDevice = null;
  user.fcmToken = [];
  user.currentSessionId = null;
  user.currentSessionDeviceId = null;
  user.sessionStartedAt = null;

  await user.save({ validateBeforeSave: false });

  if (req.io) {
    req.io.to(`user:${user._id}`).emit('force-logout', {
      reason: 'Your device access was reset by HR. Please log in again.',
      code: 'DEVICE_RESET',
    });
  }

  // The device was just unregistered, so this cannot reach the reset device —
  // it notifies the user's other live devices / next session.
  await notifyDeviceReset(user._id);

  res.status(200).json({
    success: true,
    message: `Device & session reset for ${user.firstName} ${user.lastName} (${user.employeeId}). They must log in again.`,
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Logout
// @route   POST /api/auth/logout
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.logout = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('currentSessionId fcmToken');

  const update = {};
  if (user && user.currentSessionId === req.sessionId) {
    update.$set = {
      currentSessionId: null,
      currentSessionDeviceId: null,
      sessionStartedAt: null,
    };
  }

  // Drop this device's push token so a logged-out device stops receiving
  // account notifications. Other devices keep theirs.
  const token = req.body?.fcmToken;
  if (user && token && Array.isArray(user.fcmToken) && user.fcmToken.includes(token)) {
    update.$pull = { fcmToken: token };
  }

  if (Object.keys(update).length > 0) {
    await User.findByIdAndUpdate(req.user.id, update);
  }

  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// ────────────────────────────────────────────────────────────────
// @desc    Register / refresh this device's FCM push token
// @route   PUT /api/auth/fcm-token
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.updateFcmToken = asyncHandler(async (req, res) => {
  const { fcmToken, replaceOthers = false } = req.body;

  if (!fcmToken || typeof fcmToken !== 'string') {
    throw new AppError('fcmToken (string) is required', 400, {
      code: 'MISSING_FCM_TOKEN',
    });
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  rememberFcmToken(user, fcmToken, { replaceOthers: replaceOthers === true });
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Push token registered',
    deviceCount: user.fcmToken.length,
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Get managers list (for reporting-manager dropdown)
// @route   GET /api/auth/managers
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.getManagers = asyncHandler(async (req, res) => {
  const managers = await User.find({
    role: {
      $in: [
        ACCESS_ROLES.SUPER_ADMIN,
        ACCESS_ROLES.HR_ADMIN,
        ACCESS_ROLES.MANAGER,
        ACCESS_ROLES.TEAM_LEAD,
      ],
    },
    isActive: true,
  })
    .select('employeeId firstName lastName email department designation role')
    .populate('department', 'name code')
    .sort({ firstName: 1 });

  res.status(200).json({ success: true, count: managers.length, data: managers });
});

// ────────────────────────────────────────────────────────────────
// @desc    Set user verification status (HR Admin / Superadmin only)
// @route   PATCH /api/auth/verify/:userId
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.setVerification = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) {
    throw new AppError('Not authorized', 403, { code: 'NOT_AUTHORIZED' });
  }

  const { isVerified } = req.body;
  if (typeof isVerified !== 'boolean') {
    throw new AppError('isVerified (boolean) required', 400, {
      code: 'INVALID_INPUT',
    });
  }

  const user = await User.findById(req.params.userId);
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  user.isVerified = isVerified;
  await user.save({ validateBeforeSave: false });

  // Unverified accounts cannot log in, so persist this one as well as push it.
  if (isVerified) {
    await notifyVerificationChanged(user._id, true);
  } else {
    await recordSecurityEvent({
      userId: user._id,
      title: '⚠️ Account Unverified',
      body: 'Your account verification was removed by HR. Please contact HR.',
      action: 'verification_changed',
      extra: { isVerified: 'false' },
    });
  }

  res.status(200).json({
    success: true,
    message: `User ${user.fullName} is now ${isVerified ? 'verified' : 'unverified'}`,
    isVerified,
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Assign or update reporting manager for a user
// @route   PATCH /api/auth/assign-manager/:userId
// @access  Private (HR Admin / Superadmin only)
// ────────────────────────────────────────────────────────────────
exports.assignManager = asyncHandler(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) {
    throw new AppError(
      'Not authorized. Only HR Admin or Superadmin can assign managers.',
      403,
      { code: 'NOT_AUTHORIZED' }
    );
  }

  const { userId } = req.params;
  const { reportingManager } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  if (user._id.toString() === req.user.id.toString()) {
    throw new AppError(
      'You cannot assign yourself as your own reporting manager',
      400,
      { code: 'SELF_ASSIGNMENT' }
    );
  }

  if (
    reportingManager === null ||
    reportingManager === undefined ||
    reportingManager === '' ||
    reportingManager === 'NA'
  ) {
    user.reportingManager = null;
    await user.save({ validateBeforeSave: false });
    return res.status(200).json({
      success: true,
      message: `Reporting manager removed for ${user.firstName} ${user.lastName}`,
      reportingManager: null,
    });
  }

  const trimmed = String(reportingManager).trim();
  const managerQuery = mongoose.Types.ObjectId.isValid(trimmed)
    ? { _id: trimmed }
    : { employeeId: trimmed.toUpperCase() };

  const manager = await User.findOne({
    ...managerQuery,
    isActive: true,
    role: {
      $in: [
        ACCESS_ROLES.SUPER_ADMIN,
        ACCESS_ROLES.HR_ADMIN,
        ACCESS_ROLES.MANAGER,
        ACCESS_ROLES.TEAM_LEAD,
      ],
    },
  });

  if (!manager) {
    throw new AppError(
      'Reporting manager not found or not eligible',
      404,
      { code: 'MANAGER_NOT_FOUND' }
    );
  }

  if (manager._id.toString() === user._id.toString()) {
    throw new AppError('A user cannot be their own reporting manager', 400, {
      code: 'SELF_ASSIGNMENT',
    });
  }

  if (manager.reportingManager && manager.reportingManager.toString() === user._id.toString()) {
    throw new AppError('Circular reporting hierarchy detected', 400, {
      code: 'CIRCULAR_HIERARCHY',
    });
  }

  user.reportingManager = manager._id;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Reporting manager assigned successfully',
    reportingManager: {
      id: manager._id,
      employeeId: manager.employeeId,
      fullName: `${manager.firstName} ${manager.lastName}`,
      role: manager.role,
      designation: manager.designation,
    },
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Check if current user is verified
// @route   GET /api/auth/check-verification
// @access  Private
// ────────────────────────────────────────────────────────────────
exports.checkVerification = asyncHandler(async (req, res) => {
  const incomingDeviceId = req.headers['device-id'] || req.body.deviceId;
  const userId = req.user.id;

  if (!incomingDeviceId) {
    throw new AppError('Device ID is required for verification', 400, {
      code: 'MISSING_DEVICE_ID',
    });
  }

  const user = await User.findById(userId)
    .select('+isVerified +deviceId +lastLoginDevice +lastLogin +isActive +loginAttempts +accountStatus')
    .populate('shift', 'name code startTime endTime workingDays weekendDays')
    .lean();

  if (!user) {
    throw new AppError('User not found', 404, { code: 'USER_NOT_FOUND' });
  }

  if (!user.isActive) {
    throw new AppError('Account is deactivated. Please contact HR.', 403, {
      code: 'ACCOUNT_DEACTIVATED',
      details: { isVerified: false, reason: 'ACCOUNT_DEACTIVATED' },
    });
  }

  if (!user.isVerified) {
    await User.findByIdAndUpdate(userId, {
      $inc: { loginAttempts: 1 },
      $set: { lastVerificationCheck: new Date() },
    });
    throw new AppError(
      'Your account has been unverified by HR. Please contact HR.',
      403,
      {
        code: 'UNVERIFIED_ACCOUNT',
        details: { isVerified: false, reason: 'UNVERIFIED_ACCOUNT' },
      }
    );
  }

  if (user.deviceId) {
    if (user.deviceId !== incomingDeviceId) {
      await User.findByIdAndUpdate(userId, {
        $inc: { loginAttempts: 1 },
        $push: {
          securityLogs: {
            type: 'DEVICE_MISMATCH',
            deviceId: incomingDeviceId,
            timestamp: new Date(),
            ip: req.ip,
          },
        },
      });

      if (user.loginAttempts >= 5) {
        await User.findByIdAndUpdate(userId, {
          $set: { isActive: false, accountStatus: 'LOCKED' },
        });
        throw new AppError(
          'Account locked due to suspicious activity. Contact HR.',
          403,
          {
            code: 'ACCOUNT_LOCKED',
            details: { isVerified: false, reason: 'ACCOUNT_LOCKED' },
          }
        );
      }

      throw new AppError(
        'Login detected from new device. Please login again.',
        401,
        {
          code: 'DEVICE_MISMATCH',
          details: { isVerified: true, reason: 'DEVICE_MISMATCH' },
        }
      );
    }
  } else {
    await User.findByIdAndUpdate(userId, {
      $set: {
        deviceId: incomingDeviceId,
        lastLoginDevice: incomingDeviceId,
        lastLogin: new Date(),
        loginAttempts: 0,
      },
      $push: {
        deviceHistory: {
          deviceId: incomingDeviceId,
          firstLogin: new Date(),
          ip: req.ip,
        },
      },
    });
  }

  await User.findByIdAndUpdate(userId, {
    $set: { lastActivity: new Date() },
    $inc: { loginAttempts: -1 },
  });

  res.status(200).json({
    success: true,
    message: 'User verified successfully',
    isVerified: true,
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      department: user.department,
      designation: user.designation,
      profilePicture: user.profilePicture,
      shift: user.shift,
    },
    deviceMatched: true,
    lastLogin: user.lastLogin,
  });
});

// ────────────────────────────────────────────────────────────────
// @desc    Get users (paginated)
// @route   GET /api/auth/total-users
// @access  Private (HR Admin / Superadmin)
// ────────────────────────────────────────────────────────────────
exports.getUsers = asyncHandler(async (req, res) => {
  const {
    isActive,
    limit = 50,
    page = 1,
    search,
    department,
    role,
  } = req.query;

  const filter = {
    role: { $nin: ['superadmin', 'admin'] },
  };

  if (isActive !== undefined) {
    filter.isActive = isActive === 'true';
  }
  if (department) {
    filter.department = department;
  }
  if (role) {
    filter.role = role;
  }
  if (search) {
    const regex = new RegExp(search.trim(), 'i');
    filter.$or = [
      { firstName: regex },
      { lastName: regex },
      { employeeId: regex },
      { email: regex },
      { designation: regex },
    ];
  }

  const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
  const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const skip = (pageNumber - 1) * limitNumber;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(
        '_id employeeId firstName lastName email role designation department isActive profilePicture'
      )
      .populate('department', 'name')
      .sort({ firstName: 1, lastName: 1 })
      .skip(skip)
      .limit(limitNumber)
      .lean(),

    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    count: users.length,
    total,
    page: pageNumber,
    limit: limitNumber,
    totalPages: Math.ceil(total / limitNumber),
    data: users,
  });
});