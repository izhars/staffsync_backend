// controllers/leaveController.js
const moment = require('moment-timezone');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const {
  LEAVE_TYPES, LEAVE_STATUS, LEAVE_DURATION, HALF_DAY_TYPE,
} = require('../constants/leave');
const { ACCESS_ROLES, isManager, normalizeRoleName } = require('../constants/roles');
const { canActOnLeave } = require('../utils/leavePermissions');
const {
  TZ, parseIST, toISTDisplay, isValidIST, yearRangeIST,
} = require('../utils/dateUtils');
const { sanitizeText, sanitizeDocumentUrls } = require('../utils/sanitize');
const { sendRoleBasedNotification } = require('../firebase/notificationService');
const leaveService = require('../services/leaveService');
const emailService = require('../services/emailService');
const { LeaveValidationError } = leaveService;

// ------------------------------------
// Helpers
// ------------------------------------
const actorId = (req) => req.user.id || req.user._id;

const employeeLabel = (emp) =>
  `${emp.firstName} ${emp.lastName} (${emp.employeeId || 'N/A'})`;

const restrictedInfoSuffix = (recorded) =>
  recorded.length
    ? ` [Includes ${recorded.length} restricted holiday: ${recorded.map((r) => r.holidayName).join(', ')}]`
    : '';

const handleValidationError = (res, err) => {
  if (err instanceof LeaveValidationError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  throw err;
};

// ====================================
// 1. Apply for Leave
// ====================================
exports.applyLeave = async (req, res) => {
  try {
    const {
      startDate, endDate, reason, documents,
      leaveDuration, halfDayType, leaveType,
    } = req.body;

    if (!startDate || !endDate || !leaveDuration) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (!Object.values(LEAVE_TYPES).includes(leaveType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid leaveType. Allowed: ${Object.values(LEAVE_TYPES).join(', ')}`,
      });
    }

    const start = parseIST(startDate);
    const end = parseIST(endDate);
    if (!isValidIST(start) || !isValidIST(end) || start.isAfter(end)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date range. End date must be after start date.',
      });
    }

    if (leaveDuration === LEAVE_DURATION.HALF && leaveType === LEAVE_TYPES.COMBO) {
      return res.status(400).json({ success: false, message: 'Combo leave cannot be half-day.' });
    }

    const user = await User.findById(actorId(req)).select(
      'firstName lastName employeeId email role department reportingManager leaveBalance probationEndDate'
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.probationEndDate && moment().tz(TZ).isBefore(moment(user.probationEndDate).tz(TZ))) {
      return res.status(400).json({
        success: false,
        message: 'You are on probation. Leave is not allowed until probation completes.',
      });
    }

    // ---- Compute leave days ----
    let computed;
    try {
      computed = await leaveService.validateAndComputeLeaveDays({
        start, end, leaveDuration, halfDayType,
      });
    } catch (err) { return handleValidationError(res, err); }

    const { totalDays, restrictedDatesInLeave, restrictedHolidays } = computed;
    const currentYear = start.year();

    // ---- Restricted holiday eligibility ----
    if (restrictedDatesInLeave.length > 0) {
      try {
        await leaveService.validateRestrictedHolidays({
          userId: user._id,
          // Normalize the role before passing to the service so legacy
          // aliases (e.g. 'hr', 'admin', 'teamlead') don't slip through.
          userRole: normalizeRoleName(user.role),
          restrictedDatesInLeave,
          restrictedHolidays,
          year: currentYear,
        });
      } catch (err) { return handleValidationError(res, err); }
    }

    // ---- Overlap + attendance ----
    const startDateObj = start.toDate();
    const endDateObj = end.toDate();
    try {
      await leaveService.checkOverlapsAndAttendance({
        userId: user._id,
        startDateObj,
        endDateObj,
        leaveDuration,
        halfDayType,
        start,
      });
    } catch (err) { return handleValidationError(res, err); }

    // ---- Balance ----
    const availableBalance = user.leaveBalance?.[leaveType] ?? 0;
    if (availableBalance < totalDays) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${leaveType} leave. Available: ${availableBalance} day(s), requested: ${totalDays}`,
      });
    }

    // ---- Create ----
    const leave = await Leave.create({
      employee: user._id,
      leaveType,
      leaveDuration,
      halfDayType: leaveDuration === LEAVE_DURATION.HALF ? halfDayType : null,
      startDate: startDateObj,
      endDate: endDateObj,
      totalDays,
      reason: sanitizeText(reason, 2000),
      documents: sanitizeDocumentUrls(documents),
    });

    await leave.populate(
      'employee',
      'firstName lastName employeeId email role department reportingManager'
    );

    const restrictedUsageRecorded = await leaveService.recordRestrictedHolidayUsage({
      userId: user._id,
      restrictedDatesInLeave,
      restrictedHolidays,
      year: currentYear,
      leaveId: leave._id,
    });

    // ---- Notifications ----
    const creator = actorId(req);
    const managerUsers = [];
    if (user.reportingManager) managerUsers.push(user.reportingManager);

    const suffix = restrictedInfoSuffix(restrictedUsageRecorded);

    await sendRoleBasedNotification({
      title: 'New Leave Application',
      message: `${employeeLabel(leave.employee)} applied for ${leave.leaveType} leave from ${toISTDisplay(leave.startDate)} to ${toISTDisplay(leave.endDate)} (${leave.totalDays} days).${suffix}`,
      type: 'leave',
      // FIXED: was ACCESS_ROLES.HR (undefined)
      targetRoles: [ACCESS_ROLES.HR_ADMIN],
      targetUsers: managerUsers,
      meta: {
        leaveId: leave._id,
        applicantId: user._id,
        applicantName: `${leave.employee.firstName} ${leave.employee.lastName}`,
        leaveType: leave.leaveType,
        startDate: toISTDisplay(leave.startDate),
        endDate: toISTDisplay(leave.endDate),
        totalDays: leave.totalDays,
        restrictedHolidays: restrictedUsageRecorded,
      },
      createdBy: creator,
    });

    await sendRoleBasedNotification({
      title: 'Leave Application Submitted',
      message: `Your ${leave.leaveType} leave application for ${toISTDisplay(leave.startDate)} to ${toISTDisplay(leave.endDate)} has been submitted successfully.${suffix}`,
      type: 'leave',
      targetUsers: [user._id],
      meta: {
        leaveId: leave._id,
        status: LEAVE_STATUS.PENDING,
        leaveType: leave.leaveType,
        startDate: toISTDisplay(leave.startDate),
        endDate: toISTDisplay(leave.endDate),
        restrictedHolidays: restrictedUsageRecorded,
      },
      createdBy: creator,
    });

    // ---- Email manager (fire-and-forget) ----
    if (user.reportingManager) {
      User.findById(user.reportingManager)
        .select('firstName lastName email')
        .lean()
        .then((manager) => {
          if (manager?.email) {
            return emailService.sendLeaveApprovalEmail(
              { ...leave.toObject(), restrictedHolidaysUsed: restrictedUsageRecorded },
              manager
            );
          }
        })
        .catch((err) =>
          console.error('[Email] leave-approval failed:', err.message)
        );
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = toISTDisplay(leave.startDate);
    leaveObj.endDate = toISTDisplay(leave.endDate);

    return res.status(201).json({
      success: true,
      message: restrictedUsageRecorded.length
        ? `Leave applied successfully. Counted ${restrictedUsageRecorded.length} restricted holiday against your quota.`
        : 'Leave applied successfully. Holidays were skipped in calculation.',
      leave: leaveObj,
      restrictedHolidaysUsed: restrictedUsageRecorded,
    });
  } catch (error) {
    console.error('[Leave] Apply Leave Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 2. Cancel Leave
// ====================================
exports.cancelLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id).populate(
      'employee',
      'firstName lastName employeeId role reportingManager'
    );
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    if (String(leave.employee._id) !== String(actorId(req))) {
      return res.status(403).json({
        success: false,
        message: 'Only the employee who applied can cancel this leave. Use reject instead.',
      });
    }

    if (![LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED].includes(leave.status)) {
      return res.status(400).json({
        success: false,
        message: 'You can only cancel pending or approved leaves',
      });
    }

    // Prevent cancellation of past approved leaves
    if (leave.status === LEAVE_STATUS.APPROVED) {
      const endOfLeave = moment(leave.endDate).tz(TZ).endOf('day');
      if (moment().tz(TZ).isAfter(endOfLeave)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel a leave that has already ended.',
        });
      }

      // Refund balance
      await User.findByIdAndUpdate(leave.employee._id, {
        $inc: { [`leaveBalance.${leave.leaveType}`]: leave.totalDays },
      });

      if (leave.leaveType === LEAVE_TYPES.COMBO) {
        await leaveService.releaseComboOffCredits(leave._id);
      }

      // Roll back attendance + restricted holiday usage
      await Attendance.deleteMany({ leave: leave._id });
      await leaveService.releaseRestrictedHolidayUsage({
        userId: leave.employee._id,
        leaveId: leave._id,
      });
    } else {
      // Pending leave may still have RH usage recorded
      await leaveService.releaseRestrictedHolidayUsage({
        userId: leave.employee._id,
        leaveId: leave._id,
      });
    }

    const oldStatus = leave.status;
    leave.status = LEAVE_STATUS.CANCELLED;
    leave.cancellationReason =
      sanitizeText(req.body.cancellationReason, 500) || 'Cancelled by employee';
    await leave.save();

    const employeeName = `${leave.employee.firstName} ${leave.employee.lastName}`;
    const startStr = toISTDisplay(leave.startDate);
    const endStr = toISTDisplay(leave.endDate);
    const creator = actorId(req);

    await sendRoleBasedNotification({
      title: 'Leave Cancelled by Employee',
      message: `${employeeName} cancelled their ${leave.leaveType} leave (${startStr} to ${endStr}). Previous status: ${oldStatus}`,
      type: 'leave',
      // FIXED: was ACCESS_ROLES.HR (undefined)
      targetRoles: [ACCESS_ROLES.HR_ADMIN],
      meta: {
        leaveId: leave._id,
        applicantId: leave.employee._id,
        applicantName: employeeName,
        oldStatus,
        leaveType: leave.leaveType,
        cancellationReason: leave.cancellationReason,
      },
      createdBy: creator,
    });

    if (leave.employee.reportingManager) {
      await sendRoleBasedNotification({
        title: 'Employee Leave Cancelled',
        message: `${employeeName} cancelled their ${leave.leaveType} leave (${startStr} to ${endStr}).`,
        type: 'leave',
        targetUsers: [leave.employee.reportingManager],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName,
          leaveType: leave.leaveType,
          cancellationReason: leave.cancellationReason,
        },
        createdBy: creator,
      });
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = startStr;
    leaveObj.endDate = endStr;

    return res.status(200).json({ success: true, message: 'Leave cancelled', leave: leaveObj });
  } catch (error) {
    console.error('[Leave] Cancel Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 3. Approve Leave
// ====================================
exports.approveLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id).populate(
      'employee',
      'firstName lastName employeeId email role leaveBalance'
    );
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    if (leave.status !== LEAVE_STATUS.PENDING) {
      return res.status(400).json({ success: false, message: 'Leave already processed' });
    }

    if (!(await canActOnLeave(req.user, leave.employee._id))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to approve this leave',
      });
    }

    const approver = await User.findById(actorId(req));
    if (!approver) return res.status(404).json({ success: false, message: 'Approver not found' });

    // Re-check balance at approval time
    const currentBalance = leave.employee.leaveBalance?.[leave.leaveType] ?? 0;
    if (currentBalance < leave.totalDays) {
      return res.status(400).json({
        success: false,
        message: `Employee has insufficient ${leave.leaveType} balance. Available: ${currentBalance}, required: ${leave.totalDays}`,
      });
    }

    // Reserve combo credits BEFORE marking approved (throws if insufficient)
    if (leave.leaveType === LEAVE_TYPES.COMBO) {
      try {
        await leaveService.consumeComboOffCredits({
          userId: leave.employee._id,
          leaveId: leave._id,
          totalDays: leave.totalDays,
        });
      } catch (err) {
        return handleValidationError(res, err);
      }
    }

    leave.status = LEAVE_STATUS.APPROVED;
    leave.approvedBy = actorId(req);
    leave.approvedAt = Date.now();
    await leave.save();

    await User.findByIdAndUpdate(leave.employee._id, {
      $inc: { [`leaveBalance.${leave.leaveType}`]: -leave.totalDays },
    });

    await leaveService.markAttendanceForLeave(leave);

    const startStr = toISTDisplay(leave.startDate);
    const endStr = toISTDisplay(leave.endDate);
    const approverName = `${approver.firstName} ${approver.lastName}`;
    const creator = actorId(req);

    await sendRoleBasedNotification({
      title: 'Leave Approved',
      message: `Your ${leave.leaveType} leave application (${startStr} to ${endStr}) has been approved by ${approverName}.`,
      type: 'leave',
      targetUsers: [leave.employee._id],
      meta: {
        leaveId: leave._id,
        approvedBy: creator,
        approvedByName: approverName,
        leaveType: leave.leaveType,
        startDate: startStr,
        endDate: endStr,
        totalDays: leave.totalDays,
      },
      createdBy: creator,
    });

    // FIXED: use isManager() so legacy aliases work
    if (isManager(req.user.role)) {
      await sendRoleBasedNotification({
        title: 'Leave Approved by Manager',
        message: `${approverName} (Manager) approved ${leave.employee.firstName} ${leave.employee.lastName}'s ${leave.leaveType} leave (${startStr} to ${endStr}).`,
        type: 'leave',
        targetRoles: [ACCESS_ROLES.HR_ADMIN],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
          approvedBy: creator,
          approvedByName: approverName,
          leaveType: leave.leaveType,
        },
        createdBy: creator,
      });
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = startStr;
    leaveObj.endDate = endStr;

    return res.status(200).json({ success: true, message: 'Leave approved', leave: leaveObj });
  } catch (error) {
    console.error('[Leave] Approve Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 4. Reject Leave
// ====================================
exports.rejectLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id).populate(
      'employee',
      'firstName lastName employeeId email role'
    );
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    if (leave.status !== LEAVE_STATUS.PENDING) {
      return res.status(400).json({ success: false, message: 'Leave already processed' });
    }

    if (!(await canActOnLeave(req.user, leave.employee._id))) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reject this leave',
      });
    }

    const rejecter = await User.findById(actorId(req));
    if (!rejecter) return res.status(404).json({ success: false, message: 'Rejecter not found' });

    leave.status = LEAVE_STATUS.REJECTED;
    leave.approvedBy = actorId(req);
    leave.approvedAt = Date.now();
    leave.rejectionReason = sanitizeText(req.body.rejectionReason, 500) || 'No reason provided';
    await leave.save();

    // RH usage was recorded at apply time — release it
    await leaveService.releaseRestrictedHolidayUsage({
      userId: leave.employee._id,
      leaveId: leave._id,
    });

    const startStr = toISTDisplay(leave.startDate);
    const endStr = toISTDisplay(leave.endDate);
    const rejecterName = `${rejecter.firstName} ${rejecter.lastName}`;
    const creator = actorId(req);

    await sendRoleBasedNotification({
      title: 'Leave Rejected',
      message: `Your ${leave.leaveType} leave application (${startStr} to ${endStr}) has been rejected by ${rejecterName}. Reason: ${leave.rejectionReason}`,
      type: 'leave',
      targetUsers: [leave.employee._id],
      meta: {
        leaveId: leave._id,
        rejectedBy: creator,
        rejectedByName: rejecterName,
        rejectionReason: leave.rejectionReason,
        leaveType: leave.leaveType,
        startDate: startStr,
        endDate: endStr,
      },
      createdBy: creator,
    });

    // FIXED: use isManager() so legacy aliases work
    if (isManager(req.user.role)) {
      await sendRoleBasedNotification({
        title: 'Leave Rejected by Manager',
        message: `${rejecterName} (Manager) rejected ${leave.employee.firstName} ${leave.employee.lastName}'s ${leave.leaveType} leave. Reason: ${leave.rejectionReason}`,
        type: 'leave',
        // FIXED: was ACCESS_ROLES.HR (undefined)
        targetRoles: [ACCESS_ROLES.HR_ADMIN],
        meta: {
          leaveId: leave._id,
          employeeId: leave.employee._id,
          employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
          rejectedBy: creator,
          rejectedByName: rejecterName,
          rejectionReason: leave.rejectionReason,
          leaveType: leave.leaveType,
        },
        createdBy: creator,
      });
    }

    const leaveObj = leave.toObject();
    leaveObj.startDate = startStr;
    leaveObj.endDate = endStr;

    return res.status(200).json({ success: true, message: 'Leave rejected', leave: leaveObj });
  } catch (error) {
    console.error('[Leave] Reject Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 5. Get My Leaves
// ====================================
exports.getMyLeaves = async (req, res) => {
  try {
    const { status, year } = req.query;
    const query = { employee: actorId(req) };
    if (status) query.status = status;

    if (year) {
      const { start, end } = yearRangeIST(year);
      query.$and = [
        { startDate: { $lte: end } },
        { endDate: { $gte: start } },
      ];
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'firstName lastName email');

    return res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 6. Get Single Leave
// ====================================
exports.getLeave = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email profilePicture department')
      .populate('employee.department', 'name')
      .populate('approvedBy', 'firstName lastName email');
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    const isOwner = String(leave.employee._id) === String(actorId(req));
    const allowed = isOwner || (await canActOnLeave(req.user, leave.employee._id));
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this leave' });
    }

    return res.status(200).json({ success: true, leave });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 7. Get Leave Balance
// ====================================
exports.getLeaveBalance = async (req, res) => {
  try {
    const user = await User.findById(actorId(req)).select('leaveBalance');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.status(200).json({ success: true, leaveBalance: user.leaveBalance });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 8. Get Pending Leaves (Manager/HR)
// ====================================
exports.getPendingLeaves = async (req, res) => {
  try {
    const { department } = req.query;
    const query = { status: LEAVE_STATUS.PENDING };

    // FIXED: use isManager() so legacy aliases work
    if (isManager(req.user.role)) {
      const team = await User.find({ reportingManager: actorId(req) }).select('_id').lean();
      query.employee = { $in: team.map((t) => t._id) };
    }

    if (department) {
      const deptUsers = await User.find({ department }).select('_id').lean();
      const deptIds = deptUsers.map((u) => u._id);
      query.employee = query.employee
        ? { $in: query.employee.$in.filter((id) => deptIds.some((d) => String(d) === String(id))) }
        : { $in: deptIds };
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'firstName lastName employeeId email department profilePicture')
      .populate('employee.department', 'name');

    return res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ====================================
// 9. Get All Leaves (HR/Manager)
// ====================================
exports.getAllLeaves = async (req, res) => {
  try {
    const { status, department, year } = req.query;
    const query = {};
    if (status) query.status = status;

    if (year) {
      const { start, end } = yearRangeIST(year);
      query.$and = [{ startDate: { $lte: end } }, { endDate: { $gte: start } }];
    }

    // FIXED: use isManager() so legacy aliases work
    if (isManager(req.user.role)) {
      const team = await User.find({ reportingManager: actorId(req) }).select('_id').lean();
      query.employee = { $in: team.map((t) => t._id) };
    }

    if (department) {
      const users = await User.find({ department }).select('_id').lean();
      const ids = users.map((u) => u._id);
      query.employee = query.employee
        ? { $in: query.employee.$in.filter((id) => ids.some((d) => String(d) === String(id))) }
        : { $in: ids };
    }

    const leaves = await Leave.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'firstName lastName employeeId email department profilePicture')
      .populate('approvedBy', 'firstName lastName email');

    return res.status(200).json({ success: true, count: leaves.length, leaves });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};