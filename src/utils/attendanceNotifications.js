const { notifyUser, notifyUsers } = require('./notify');

const TZ = 'Asia/Kolkata';

/** Format a punch time in IST, tolerating Date | ISO string | falsy. */
function formatIST(time) {
  if (!time) return '';
  try {
    return new Date(time).toLocaleTimeString('en-IN', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const sessionLabel = (session) =>
  !session || session === 'work' ? 'work' : session;

// ─────────────────────────────────────────────────────────────────────────────
// EVENT-BASED: fired immediately when the employee punches in/out
// ─────────────────────────────────────────────────────────────────────────────

/** Punch-IN confirmation. */
async function notifyPunchInSuccess(userId, { time, session = 'work' } = {}) {
  const timeStr = formatIST(time);
  const label = sessionLabel(session);

  return notifyUser(userId, {
    title: '✅ Punched In Successfully',
    body: timeStr
      ? `Your ${label} punch-in was recorded at ${timeStr}. Have a great day!`
      : `Your ${label} punch-in was recorded. Have a great day!`,
    type: 'attendance',
    data: { action: 'punch_in_confirmed', session: label, time: timeStr },
  });
}

/** Punch-OUT confirmation (morning or evening). */
async function notifyPunchOutSuccess(userId, { time, session = 'morning' } = {}) {
  const timeStr = formatIST(time);
  const label = sessionLabel(session);

  return notifyUser(userId, {
    title: '👋 Punched Out Successfully',
    body: timeStr
      ? `Your ${label} punch-out was recorded at ${timeStr}. See you next session!`
      : `Your ${label} punch-out was recorded.`,
    type: 'attendance',
    data: { action: 'punch_out_confirmed', session: label, time: timeStr },
  });
}

/**
 * Fire AFTER a successful punch-in (morning or evening).
 * NEVER throws — a failed notification must not break the punch flow.
 */
async function onPunchIn(userId, { time, session } = {}) {
  try {
    await notifyPunchInSuccess(userId, { time, session });
  } catch (err) {
    console.error(`[attendance-notif] punch-in failed for ${userId}:`, err.message);
  }
}

/** Fire AFTER a successful punch-out. NEVER throws. */
async function onPunchOut(userId, { time, session } = {}) {
  try {
    await notifyPunchOutSuccess(userId, { time, session });
  } catch (err) {
    console.error(`[attendance-notif] punch-out failed for ${userId}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER-BASED: fired by cron for employees who forgot to punch
// ─────────────────────────────────────────────────────────────────────────────

async function notifyMorningPunchIn(userId) {
  return notifyUser(userId, {
    title: 'Good Morning! 🌞',
    body: "Don't forget to punch in for today!",
    type: 'attendance',
    data: { action: 'morning_punch_in_reminder' },
  });
}

async function notifyMorningPunchOut(userId) {
  return notifyUser(userId, {
    title: 'Morning Session Done! ☕',
    body: 'Remember to punch out for the morning session!',
    type: 'attendance',
    data: { action: 'morning_punch_out_reminder' },
  });
}

async function notifyEveningPunchIn(userId) {
  return notifyUser(userId, {
    title: 'Back for Evening Shift 🌆',
    body: 'Time to punch in for the evening session!',
    type: 'attendance',
    data: { action: 'evening_punch_in_reminder' },
  });
}

async function notifyEveningPunchOut(userId) {
  return notifyUser(userId, {
    title: 'Evening Session Over 🌙',
    body: "Don't forget to punch out before leaving!",
    type: 'attendance',
    data: { action: 'evening_punch_out_reminder' },
  });
}

/**
 * Send a reminder batch.
 * kind: 'morning_in' | 'morning_out' | 'evening_in' | 'evening_out'
 */
async function sendReminders(kind, userIds = []) {
  const map = {
    morning_in: notifyMorningPunchIn,
    morning_out: notifyMorningPunchOut,
    evening_in: notifyEveningPunchIn,
    evening_out: notifyEveningPunchOut,
  };
  const fn = map[kind];
  if (!fn) throw new Error(`Unknown reminder kind: ${kind}`);

  const results = await Promise.allSettled(userIds.map((id) => fn(id)));
  return {
    total: userIds.length,
    successful: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEPTION / AUDIT ALERTS (new)
// ─────────────────────────────────────────────────────────────────────────────

/** A punch was never closed out for the day. */
async function notifyMissedCheckout(userId, { date, checkInTime } = {}) {
  const timeStr = formatIST(checkInTime);
  return notifyUser(userId, {
    title: '⚠️ Missed Punch Out',
    body: timeStr
      ? `You punched in at ${timeStr} but never punched out${date ? ` on ${date}` : ''}. Please raise a regularisation request.`
      : `Your punch-out is missing${date ? ` for ${date}` : ''}. Please raise a regularisation request.`,
    type: 'attendance',
    data: { action: 'missed_checkout', date: date || '', time: timeStr },
  });
}

/** Employee was marked absent for a day (no punches, no approved leave). */
async function notifyMarkedAbsent(userId, { date, reason } = {}) {
  return notifyUser(userId, {
    title: '📋 Marked Absent',
    body: `You were marked absent${date ? ` on ${date}` : ''}.${reason ? ` ${reason}` : ' If this is incorrect, please raise a regularisation request.'}`,
    type: 'attendance',
    data: { action: 'marked_absent', date: date || '' },
  });
}

/** Late arrival recorded. */
async function notifyLateArrival(userId, { date, minutes, checkInTime } = {}) {
  const timeStr = formatIST(checkInTime);
  return notifyUser(userId, {
    title: '⏰ Late Arrival Recorded',
    body: `You were marked late${minutes ? ` by ${minutes} minute(s)` : ''}${timeStr ? ` (punched in at ${timeStr})` : ''}.`,
    type: 'attendance',
    data: { action: 'late_arrival', date: date || '', minutes: String(minutes ?? '') },
  });
}

/** Short attendance / early leave recorded. */
async function notifyShortAttendance(userId, { date, minutes } = {}) {
  return notifyUser(userId, {
    title: '⏳ Short Attendance',
    body: `Your working hours fell short${minutes ? ` by ${minutes} minute(s)` : ''}${date ? ` on ${date}` : ''}.`,
    type: 'attendance',
    data: { action: 'short_attendance', date: date || '', minutes: String(minutes ?? '') },
  });
}

/** A regularisation / correction request changed state. */
async function notifyRegularisationUpdate(userId, { date, status, note } = {}) {
  const labels = {
    approved: { title: '✅ Attendance Regularised', tone: 'was approved' },
    rejected: { title: '❌ Regularisation Rejected', tone: 'was rejected' },
    pending: { title: '📝 Regularisation Submitted', tone: 'was submitted' },
  };
  const meta = labels[status] || { title: '📝 Attendance Update', tone: `is now ${status}` };

  return notifyUser(userId, {
    title: meta.title,
    body: `Your attendance correction${date ? ` for ${date}` : ''} ${meta.tone}.${note ? ` Note: ${note}` : ''}`,
    type: 'attendance',
    data: { action: 'regularisation_update', status: status || '', date: date || '' },
  });
}

/**
 * Tell HR/approvers that an attendance exception needs attention.
 * Accepts a list of recipient ids.
 */
async function notifyAttendanceExceptions(recipientIds, { employeeName, date, kind } = {}) {
  const titles = {
    missed_checkout: '⚠️ Missed Punch Out',
    absent: '📋 Absent Without Leave',
    late: '⏰ Late Arrival',
    short: '⏳ Short Attendance',
  };
  return notifyUsers(recipientIds, {
    title: titles[kind] || '📋 Attendance Exception',
    body: `${employeeName || 'An employee'}${date ? ` — ${date}` : ''}`,
    type: 'attendance',
    data: { action: `exception_${kind || 'unknown'}`, date: date || '' },
  });
}

module.exports = {
  // event-based
  notifyPunchInSuccess,
  notifyPunchOutSuccess,
  onPunchIn,
  onPunchOut,
  // reminders
  notifyMorningPunchIn,
  notifyMorningPunchOut,
  notifyEveningPunchIn,
  notifyEveningPunchOut,
  sendReminders,
  // exceptions
  notifyMissedCheckout,
  notifyMarkedAbsent,
  notifyLateArrival,
  notifyShortAttendance,
  notifyRegularisationUpdate,
  notifyAttendanceExceptions,
  formatIST,
};
