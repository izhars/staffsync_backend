// services/leaveService.js
const moment = require('moment-timezone');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const Holiday = require('../models/Holiday');
const RestrictedHolidayUsage = require('../models/RestrictedHolidayUsage');
const ComboOff = require('../models/ComboOff');
const {
  LEAVE_STATUS, LEAVE_DURATION, HALF_DAY_TYPE,
  HOLIDAY_CATEGORY, RESTRICTED_HOLIDAY_DEFAULT_QUOTA,
  ATTENDANCE_STATUS, MAX_LEAVE_DAYS_PER_REQUEST,
} = require('../constants/leave');
const {
  TZ, toISTKey, buildLeaveDayKeys, isWeekendKey,
} = require('../utils/dateUtils');

class LeaveValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'LeaveValidationError';
    this.status = status;
  }
}

/** Total working days for a leave request, respecting weekends + mandatory holidays. */
const calculateWorkingDays = ({ start, end, leaveDuration, halfDayType, mandatorySet }) => {
  if (leaveDuration === LEAVE_DURATION.HALF) {
    if (!start.isSame(end, 'day')) {
      throw new LeaveValidationError('Half-day leave can only be applied for a single day.');
    }
    if (![HALF_DAY_TYPE.FIRST, HALF_DAY_TYPE.SECOND].includes(halfDayType)) {
      throw new LeaveValidationError('halfDayType must be "first_half" or "second_half".');
    }
    const key = start.format('YYYY-MM-DD');
    if (isWeekendKey(key)) {
      throw new LeaveValidationError('Half-day leave cannot be applied on a weekend.');
    }
    if (mandatorySet.has(key)) {
      throw new LeaveValidationError('Half-day leave cannot be applied on a mandatory holiday.');
    }
    return 0.5;
  }

  const keys = buildLeaveDayKeys(start, end, mandatorySet);
  return keys.reduce((acc, k) => acc + (isWeekendKey(k) ? 0 : 1), 0);
};

/**
 * Fetches holidays, validates the range, and returns:
 *   { totalDays, leaveDayKeys, restrictedDatesInLeave, restrictedHolidays, mandatorySet }
 */
const validateAndComputeLeaveDays = async ({
  start, end, leaveDuration, halfDayType,
}) => {
  const holidays = await Holiday.find({
    date: { $gte: start.toDate(), $lte: end.endOf('day').toDate() },
    isActive: true,
  }).lean();

  const mandatoryHolidays = holidays.filter((h) => h.category === HOLIDAY_CATEGORY.MANDATORY);
  const restrictedHolidays = holidays.filter((h) => h.category === HOLIDAY_CATEGORY.RESTRICTED);

  const mandatorySet = new Set(mandatoryHolidays.map((h) => toISTKey(h.date)));
  const restrictedSet = new Set(restrictedHolidays.map((h) => toISTKey(h.date)));

  const totalDays = calculateWorkingDays({
    start, end, leaveDuration, halfDayType, mandatorySet,
  });

  if (totalDays === 0) {
    throw new LeaveValidationError('All selected dates are non-working days or mandatory holidays.');
  }
  if (totalDays > MAX_LEAVE_DAYS_PER_REQUEST) {
    throw new LeaveValidationError(`Leave cannot exceed ${MAX_LEAVE_DAYS_PER_REQUEST} days per request.`);
  }

  const leaveDayKeys = leaveDuration === LEAVE_DURATION.HALF
    ? [start.format('YYYY-MM-DD')]
    : buildLeaveDayKeys(start, end, mandatorySet).filter((k) => !isWeekendKey(k));

  const restrictedDatesInLeave = leaveDayKeys.filter((k) => restrictedSet.has(k));

  return { totalDays, leaveDayKeys, restrictedDatesInLeave, restrictedHolidays, mandatorySet };
};

/** Throws LeaveValidationError if any restricted holiday is ineligible or over quota. */
const validateRestrictedHolidays = async ({
  userId, userRole, restrictedDatesInLeave, restrictedHolidays, year,
}) => {
  for (const rhDateStr of restrictedDatesInLeave) {
    const rh = restrictedHolidays.find((h) => toISTKey(h.date) === rhDateStr);
    if (!rh) continue;

    if (rh.applicableTo && !rh.applicableTo.includes('all') && !rh.applicableTo.includes(userRole)) {
      throw new LeaveValidationError(
        `You are not eligible for the restricted holiday: ${rh.name} (${rhDateStr})`, 403
      );
    }

    const alreadyUsed = await RestrictedHolidayUsage.findOne({ employee: userId, holiday: rh._id });
    if (alreadyUsed) {
      throw new LeaveValidationError(`You have already availed the restricted holiday: ${rh.name}`);
    }

    const quota = rh.maxAllowed && rh.maxAllowed > 0 ? rh.maxAllowed : RESTRICTED_HOLIDAY_DEFAULT_QUOTA;
    const usedCount = await RestrictedHolidayUsage.countDocuments({ employee: userId, year });
    if (usedCount >= quota) {
      throw new LeaveValidationError(
        `You have exhausted your restricted holiday quota for ${year} (${usedCount}/${quota} used). Cannot apply leave on ${rh.name}.`
      );
    }
  }
};

/** Throws on overlapping leaves or attendance conflicts. */
const checkOverlapsAndAttendance = async ({
  userId, startDateObj, endDateObj, leaveDuration, halfDayType, start,
}) => {
  const overlapQuery = {
    employee: userId,
    status: { $in: [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED] },
    startDate: { $lte: endDateObj },
    endDate: { $gte: startDateObj },
    leaveDuration,
  };
  if (leaveDuration === LEAVE_DURATION.HALF) {
    overlapQuery.halfDayType = halfDayType;
  }

  const overlap = await Leave.findOne(overlapQuery).lean();
  if (overlap) {
    throw new LeaveValidationError(
      leaveDuration === LEAVE_DURATION.HALF
        ? `Cannot apply ${halfDayType} leave. Already exists for this date.`
        : 'Cannot apply leave. A leave already exists for these dates.'
    );
  }

  const attendance = await Attendance.find({
    employee: userId,
    date: { $gte: startDateObj, $lte: endDateObj },
    $or: [{ 'checkIn.time': { $ne: null } }, { 'checkOut.time': { $ne: null } }],
  }).lean();

  if (attendance.length === 0) return;

  if (leaveDuration === LEAVE_DURATION.HALF) {
    const att = attendance.find((a) => toISTKey(a.date) === start.format('YYYY-MM-DD'));
    if (att && halfDayType === HALF_DAY_TYPE.FIRST) {
      throw new LeaveValidationError(
        'You already punched in today. First half leave not allowed, apply for second half instead.'
      );
    }
  } else {
    const punchedDates = [...new Set(attendance.map((a) => toISTKey(a.date)))];
    throw new LeaveValidationError(
      `You already punched in on ${punchedDates.join(', ')}, leave not allowed for these dates.`
    );
  }
};

/** Idempotently records restricted holiday usage for a leave. */
const recordRestrictedHolidayUsage = async ({
  userId, restrictedDatesInLeave, restrictedHolidays, year, leaveId,
}) => {
  const recorded = [];
  for (const rhDateStr of restrictedDatesInLeave) {
    const rh = restrictedHolidays.find((h) => toISTKey(h.date) === rhDateStr);
    if (!rh) continue;
    try {
      await RestrictedHolidayUsage.create({
        employee: userId,
        holiday: rh._id,
        date: rh.date,
        year,
        action: 'applied_leave',
        leave: leaveId,
      });
      recorded.push({ holidayName: rh.name, date: rhDateStr, holidayId: rh._id });
    } catch (err) {
      if (err.code !== 11000) {
        console.error('[Leave] Failed to record restricted holiday usage:', err);
      }
    }
  }
  return recorded;
};

/** Releases restricted holiday usage rows tied to a cancelled/rejected leave. */
const releaseRestrictedHolidayUsage = async ({ userId, leaveId }) => {
  await RestrictedHolidayUsage.deleteMany({ employee: userId, leave: leaveId });
};

/** Marks attendance for every working day in an approved leave. */
const markAttendanceForLeave = async (leave) => {
  const cur = moment(leave.startDate).tz(TZ).startOf('day');
  const last = moment(leave.endDate).tz(TZ).startOf('day');
  const status = leave.leaveDuration === LEAVE_DURATION.HALF
    ? (leave.halfDayType === HALF_DAY_TYPE.FIRST
        ? ATTENDANCE_STATUS.HALF_FIRST
        : ATTENDANCE_STATUS.HALF_SECOND)
    : ATTENDANCE_STATUS.ON_LEAVE;

  const ops = [];
  while (cur.isSameOrBefore(last, 'day')) {
    const key = cur.format('YYYY-MM-DD');
    if (isWeekendKey(key)) { cur.add(1, 'day'); continue; }
    ops.push({
      updateOne: {
        filter: { employee: leave.employee, date: cur.toDate() },
        update: {
          $set: {
            employee: leave.employee,
            date: cur.toDate(),
            status,
            leave: leave._id,
          },
        },
        upsert: true,
      },
    });
    cur.add(1, 'day');
  }
  if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });
};

/** Consumes combo-off credits for a combo leave. Throws if insufficient. */
const consumeComboOffCredits = async ({ userId, leaveId, totalDays }) => {
  const credits = await ComboOff.find({
    employee: userId,
    status: 'approved',
    isCredited: true,
    usedInLeave: null,
  })
    .sort({ workDate: 1 })
    .limit(totalDays)
    .select('_id')
    .lean();

  if (credits.length < totalDays) {
    throw new LeaveValidationError(
      `Insufficient combo-off credits. Required: ${totalDays}, available: ${credits.length}.`
    );
  }

  await ComboOff.updateMany(
    { _id: { $in: credits.map((c) => c._id) } },
    { $set: { usedInLeave: leaveId } }
  );
};

/** Releases combo-off credits linked to a leave (on cancel/reject). */
const releaseComboOffCredits = async (leaveId) => {
  await ComboOff.updateMany(
    { usedInLeave: leaveId },
    { $set: { usedInLeave: null } }
  );
};

module.exports = {
  LeaveValidationError,
  calculateWorkingDays,
  validateAndComputeLeaveDays,
  validateRestrictedHolidays,
  checkOverlapsAndAttendance,
  recordRestrictedHolidayUsage,
  releaseRestrictedHolidayUsage,
  markAttendanceForLeave,
  consumeComboOffCredits,
  releaseComboOffCredits,
};