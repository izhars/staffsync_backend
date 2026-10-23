// services/attendanceResolver.js
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const ComboOff = require('../models/ComboOff');
const Leave = require('../models/Leave');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ─────────────────────────────────────────────
// IST date helpers — critical for Attendance lookups
// ─────────────────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

/**
 * Convert any Date (or ISO string) to the calendar date as seen in IST.
 * Returns 'YYYY-MM-DD'.
 *
 * Example:
 *   new Date('2026-09-17T18:30:00.000Z')  → '2026-09-18'   (midnight IST)
 *   new Date('2026-09-18T04:50:00.000Z')  → '2026-09-18'   (10:20 IST)
 */
const toISTDate = (d) => {
  const dt = new Date(d);
  const shifted = new Date(dt.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
};

/**
 * Build the calendar key 'YYYY-MM-DD' for a given (year, month, day) in IST.
 * Does NOT depend on the server's local timezone.
 */
const istKey = (year, month, day) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Return a Date object representing midnight IST of a given calendar date.
 * This is what we use to compare against attendance records.
 */
const istMidnight = (year, month, day) =>
  new Date(`${istKey(year, month, day)}T00:00:00+05:30`);

/**
 * Return a Date for the join-day boundary in IST (midnight of DOJ).
 */
const istStartOfDay = (d) => {
  const key = toISTDate(d);
  return new Date(`${key}T00:00:00+05:30`);
};

/**
 * Return a Date for the last millisecond of the leave-day in IST.
 */
const istEndOfDay = (d) => {
  const key = toISTDate(d);
  return new Date(`${key}T23:59:59.999+05:30`);
};

// ─────────────────────────────────────────────
// buildMonthMap
// ─────────────────────────────────────────────
async function buildMonthMap({
  employeeId,
  year,
  month,
  publicHolidays = [],
  dateOfJoining = null,
  dateOfLeaving = null,
}) {
  const TAG = '[buildMonthMap]';

  // Widen the query window by ±1 day in UTC to catch IST-midnight records
  const queryStart = new Date(Date.UTC(year, month - 1, 1) - 24 * 60 * 60 * 1000);
  const queryEnd   = new Date(Date.UTC(year, month, 0, 23, 59, 59) + 24 * 60 * 60 * 1000);

  const daysInMonth = new Date(year, month, 0).getDate();

  const holidaySet = new Set(
    publicHolidays.map((h) =>
      typeof h === 'string' ? h.slice(0, 10) : toISTDate(h)
    )
  );

  // Pull all relevant records in parallel
  const [attendance, leaves, comboOffs, employee] = await Promise.all([
    Attendance.find({
      employee: employeeId,
      date: { $gte: queryStart, $lte: queryEnd },
    }).lean(),

    Leave.find({
      employee: employeeId,
      status: 'approved',
      startDate: { $lte: queryEnd },
      endDate:   { $gte: queryStart },
    }).lean(),

    ComboOff.find({
      employee: employeeId,
      status: 'approved',
      workDate: { $gte: queryStart, $lte: queryEnd },
    }).lean(),

    mongoose.model('User').findById(employeeId)
      .select('weekendType shift dateOfJoining dateOfLeaving')
      .populate('shift', 'workingDays weekendDays')
      .lean(),
  ]);

  // ── Resolve employment window ──
  const doj = dateOfJoining || employee?.dateOfJoining || null;
  const dol = dateOfLeaving || employee?.dateOfLeaving || null;

  const joinDay  = doj ? istStartOfDay(new Date(doj)) : null;
  const leaveDay = dol ? istEndOfDay(new Date(dol))   : null;

  // Index helpers
  const attByDate = new Map();
  for (const a of attendance) {
    const key = toISTDate(a.date);
    attByDate.set(key, a);
  }

  const leaveByDate = new Map();
  for (const lv of leaves) {
    const cur  = new Date(lv.startDate);
    const last = new Date(lv.endDate);
    while (cur <= last) {
      const key = toISTDate(cur);
      const existing = leaveByDate.get(key);
      if (!existing || (existing.leaveDuration === 'half' && lv.leaveDuration === 'full')) {
        leaveByDate.set(key, lv);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const comboSet = new Set(comboOffs.map((c) => toISTDate(c.workDate)));

  const weekendType = employee?.weekendType || 'sunday';

  const map = {};
  let preJoiningCount = 0;
  let weekendCount = 0;
  let presentCount = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const key  = istKey(year, month, d);
    const date = istMidnight(year, month, d);
    // Day-of-week in IST
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();

    // ── Employment window (compare IST-timestamps) ──
    const dayTs = date.getTime();
    const beforeJoining = joinDay && dayTs < joinDay.getTime();
    const afterLeaving  = leaveDay && dayTs > leaveDay.getTime();

    if (beforeJoining || afterLeaving) {
      map[key] = {
        date: key,
        dayOfWeek: dow,
        isWeekend: false,
        isHoliday: false,
        status: beforeJoining ? 'pre-joining' : 'post-leaving',
        payableFraction: 0,
        lateMinutes: 0,
        shortMinutes: 0,
        source: 'employment-window',
        skip: true,
      };
      preJoiningCount++;
      continue;
    }

    // Weekend rule
    const isWeekend = weekendType === 'saturday_sunday'
      ? (dow === 0 || dow === 6)
      : (dow === 0);
    const isHoliday = holidaySet.has(key);

    const res = {
      date: key,
      dayOfWeek: dow,
      isWeekend,
      isHoliday,
      status: 'absent',
      payableFraction: 0,
      lateMinutes: 0,
      shortMinutes: 0,
      source: 'calendar',
      skip: false,
    };

    // Priority 1: holiday/weekend
    if (isHoliday || isWeekend) {
      res.status = isHoliday ? 'holiday' : 'weekend';
      res.payableFraction = 1;
      res.source = 'calendar';
      if (isWeekend) weekendCount++;
    }

    // Priority 2: approved leave
    if (leaveByDate.has(key)) {
      const lv = leaveByDate.get(key);
      res.status = 'leave';
      res.payableFraction = lv.leaveDuration === 'half' ? 0.5 : 1;
      res.source = 'leave';
    }

    // Priority 3: attendance record (strongest signal)
    if (attByDate.has(key)) {
      const a = attByDate.get(key);

      if (a.status === 'combo-off' || comboSet.has(key)) {
        res.status = 'combo-off';
        res.payableFraction = 1;
        res.source = 'combo-off';
      } else if (a.status === 'present') {
        res.status = 'present';
        res.payableFraction = 1;
        res.source = 'attendance';
        presentCount++;

        if (a.isLate) {
          res.lateMinutes = a.lateBy || 0;
          res.status = 'late';
        }
        if (a.isShortAttendance) {
          res.shortMinutes = a.shortByMinutes || 0;
          res.status = res.status === 'late' ? 'late-short' : 'short';
        }
      } else if (a.status === 'half-day') {
        res.status = 'half-day';
        res.payableFraction = 0.5;
        res.source = 'attendance';
      } else if (a.status === 'absent') {
        if (!leaveByDate.has(key) && !isHoliday && !isWeekend) {
          res.status = 'absent';
          res.payableFraction = 0;
          res.source = 'attendance';
        }
      } else if (a.status === 'on-leave') {
        res.status = 'leave';
        res.payableFraction = 1;
        res.source = 'attendance';
      } else if (a.status === 'weekly-off') {
        // Explicit weekly-off record — honor it
        res.status = 'weekend';
        res.payableFraction = 1;
        res.source = 'attendance';
        weekendCount++;
      }
    }

    map[key] = res;
  }

  return map;
}

// ─────────────────────────────────────────────
// summarize
// ─────────────────────────────────────────────
function summarize(map, policy = {}) {
  const TAG = '[summarize]';

  const {
    paidWeekends   = true,
    paidHolidays   = true,
    paidLeaves     = true,
    latePenalty    = 'none',
    shortPenalty   = 'none',
    graceMinutes   = 15,
    halfDayLateMin = 120,
  } = policy;

  const summary = {
    totalDays: 0,
    calendarDays: 0,
    employedDays: 0,
    workDays: 0,
    presentDays: 0,
    lateDays: 0,
    shortDays: 0,
    halfDays: 0,
    leaveDays: 0,
    comboOffDays: 0,
    absentDays: 0,
    weekendDays: 0,
    holidayDays: 0,
    preJoiningDays: 0,
    postLeavingDays: 0,
    payableDays: 0,
    totalLateMinutes: 0,
    totalShortMinutes: 0,
  };

  let lateCount = 0, shortCount = 0, skippedCount = 0;

  for (const key of Object.keys(map)) {
    const d = map[key];
    summary.calendarDays++;

    if (d.skip) {
      skippedCount++;
      if (d.status === 'pre-joining')  summary.preJoiningDays++;
      if (d.status === 'post-leaving') summary.postLeavingDays++;
      continue;
    }

    summary.totalDays++;
    summary.employedDays++;

    if (d.status === 'weekend')   summary.weekendDays++;
    if (d.status === 'holiday')   summary.holidayDays++;
    if (d.status === 'leave')     summary.leaveDays++;
    if (d.status === 'combo-off') summary.comboOffDays++;
    if (d.status === 'absent')    summary.absentDays++;
    if (d.status === 'half-day')  summary.halfDays++;

    if (['present', 'late', 'short', 'late-short'].includes(d.status)) {
      summary.presentDays++;
    }
    if (d.status.includes('late'))  { summary.lateDays++;  summary.totalLateMinutes  += d.lateMinutes;  lateCount++;  }
    if (d.status.includes('short')) { summary.shortDays++; summary.totalShortMinutes += d.shortMinutes; shortCount++; }

    let fraction = d.payableFraction;
    if (d.status === 'weekend' && !paidWeekends) fraction = 0;
    if (d.status === 'holiday' && !paidHolidays) fraction = 0;
    if (d.status === 'leave'   && !paidLeaves)   fraction = 0;

    summary.payableDays += fraction;
  }

  if (latePenalty === 'half-day-per-3') {
    const deductions = Math.floor(lateCount / 3) * 0.5;
    summary.payableDays = Math.max(0, summary.payableDays - deductions);
    summary.halfDaysFromLate = deductions;
  }
  if (shortPenalty === 'half-day-per-3') {
    const deductions = Math.floor(shortCount / 3) * 0.5;
    summary.payableDays = Math.max(0, summary.payableDays - deductions);
    summary.halfDaysFromShort = deductions;
  }

  summary.workDays = summary.totalDays - summary.weekendDays - summary.holidayDays;
  summary.payableDays = round2(Math.min(summary.payableDays, summary.totalDays));

  const ratio = summary.employedDays > 0 ? summary.payableDays / summary.employedDays : 0;
  return summary;
}

module.exports = { buildMonthMap, summarize };