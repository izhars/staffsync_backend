// utils/cronJobs.js
const cron = require('node-cron');
const moment = require('moment-timezone');
const User = require('../models/User');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');

const { updateCronRun, getLastCronRun } = require('./cronLogger');
const {
  sendCelebrationNotifications,
  scheduleCelebrationNotifications,
} = require('./celebrationScheduler');

const { sendReminders } = require('../utils/attendanceNotifications');
const { ADMIN_ROLES } = require('../constants/roles');

const emailService = require('../services/emailService');
const {
  sendAllCelebrationEmails,
  sendBirthdayEmail,
  sendWorkAnniversaryEmail,
  sendMarriageAnniversaryEmail,
} = require('./celebrationEmailService');

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

/**
 * Safely add exactly 1 month to a date.
 */
function addOneMonth(date) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Check if employee is on approved leave today
 */
async function isEmployeeOnLeave(employeeId) {
  const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
  const leave = await Leave.findOne({
    employee: employeeId,
    startDate: { $lte: today },
    endDate: { $gte: today },
    status: 'approved',
  });
  return !!leave;
}

// ───────────────────────────────────────────────
// Attendance reminder helpers
// ───────────────────────────────────────────────

async function getActiveNonAdminEmployees() {
  return User.find({
    isActive: true,
    role: { $nin: ADMIN_ROLES },
  }).select('_id').lean();
}

async function getEmployeesForMorningPunchIn() {
  const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
  const employees = await getActiveNonAdminEmployees();
  const toNotify = [];

  for (const emp of employees) {
    if (await isEmployeeOnLeave(emp._id)) continue;
    const att = await Attendance.findOne({ employee: emp._id, date: today }).lean();
    if (!att || !att.checkIn?.time) toNotify.push(emp._id);
  }
  return toNotify;
}

async function getEmployeesForEveningPunchOut() {
  const today = moment().tz('Asia/Kolkata').startOf('day').toDate();
  const employees = await getActiveNonAdminEmployees();
  const toNotify = [];

  for (const emp of employees) {
    if (await isEmployeeOnLeave(emp._id)) continue;
    const att = await Attendance.findOne({ employee: emp._id, date: today }).lean();
    if (att?.eveningCheckIn?.time && !att?.eveningCheckOut?.time) {
      toNotify.push(emp._id);
    }
  }
  return toNotify;
}

// ───────────────────────────────────────────────
// Task Definitions
// ───────────────────────────────────────────────
const cronTasks = {
  /**
   * Credit 2 casual leaves every month to post-probation employees
   */
  creditProbationCompletionLeave: async () => {
    try {
      await updateCronRun('creditProbationCompletionLeave');
      const now = new Date();
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const employees = await User.find({
        isActive: true,
        status: 'active',
        role: { $nin: ADMIN_ROLES },
        isProbationCompleted: true,
        probationEndDate: { $lte: oneMonthAgo },
      });

      let credited = 0;
      let skipped = 0;

      for (const emp of employees) {
        const lastCredit = emp.leaveCreditedAt || emp.probationEndDate;
        if (!lastCredit) {
          console.warn(`⚠️ Skipping ${emp.employeeId}: no probationEndDate`);
          skipped++;
          continue;
        }
        const nextCreditDue = addOneMonth(lastCredit);
        if (now < nextCreditDue) continue;

        emp.leaveBalance.casual = (emp.leaveBalance.casual || 0) + 2;
        emp.leaveCreditedAt = now;
        emp.leaveCreditType = 'monthly-accrual';

        if (!Array.isArray(emp.leaveHistory)) emp.leaveHistory = [];
        emp.leaveHistory.push({
          action: 'credit',
          leaveType: 'casual',
          amount: 2,
          balanceAfter: { ...(emp.leaveBalance.toObject?.() ?? emp.leaveBalance) },
          reason: 'Monthly accrual — 2 casual leaves credited',
          performedAt: now,
        });

        await emp.save();
        credited++;
      }

      return { success: true, credited, skipped };
    } catch (error) {
      console.error('❌ Error crediting monthly casual leave:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Monthly attendance report (placeholder)
   */
  generateMonthlyReport: async () => {
    try {
      await updateCronRun('generateMonthlyReport');
      return { success: true };
    } catch (error) {
      console.error('❌ Error generating monthly report:', error);
      return { success: false, error: error.message };
    }
  },

  // ─── Attendance reminders ───

  notifyMorningPunchIn: async () => {
    try {
      await updateCronRun('notifyMorningPunchIn');
      const ids = await getEmployeesForMorningPunchIn();
      if (ids.length === 0) return { success: true, count: 0 };
      const r = await sendReminders('morning_in', ids);
      return { success: true, count: ids.length, ...r };
    } catch (error) {
      console.error('❌ Error sending morning punch-in reminders:', error);
      return { success: false, error: error.message };
    }
  },

  notifyEveningPunchOut: async () => {
    try {
      await updateCronRun('notifyEveningPunchOut');
      const ids = await getEmployeesForEveningPunchOut();
      if (ids.length === 0) return { success: true, count: 0 };
      const r = await sendReminders('evening_out', ids);
      return { success: true, count: ids.length, ...r };
    } catch (error) {
      console.error('❌ Error sending evening punch-out reminders:', error);
      return { success: false, error: error.message };
    }
  },

  // ─── Celebrations ───

  sendBirthdayWishes: async () => {
    try {
      await updateCronRun('sendBirthdayWishes');
      const today = moment().tz('Asia/Kolkata');
      const month = today.month() + 1;
      const day = today.date();

      const employees = await User.find({
        isActive: true,
        role: { $nin: ADMIN_ROLES },
        $expr: {
          $and: [
            { $eq: [{ $month: '$dateOfBirth' }, month] },
            { $eq: [{ $dayOfMonth: '$dateOfBirth' }, day] },
          ],
        },
      });

      if (employees.length === 0) {
        return { success: true, count: 0, message: 'No birthdays today' };
      }

      const results = await Promise.allSettled(
        employees.map((emp) => sendBirthdayEmail(emp))
      );
      const successful = results.filter(
        (r) => r.status === 'fulfilled' && r.value?.success
      ).length;

      return {
        success: true,
        count: employees.length,
        sent: successful,
        failed: employees.length - successful,
      };
    } catch (error) {
      console.error('❌ Error sending birthday wishes:', error);
      return { success: false, error: error.message };
    }
  },

  sendCelebrationNotifications: async () => {
    try {
      await updateCronRun('sendCelebrationNotifications');
      const result = await sendAllCelebrationEmails();
      return result;
    } catch (error) {
      console.error('❌ Error in celebration notifications cron:', error);
      return { success: false, error: error.message };
    }
  },
};

// ───────────────────────────────────────────────
// Cron Schedules (all in IST)
// ───────────────────────────────────────────────

/* 🎂 BIRTHDAY WISHES — 9:00 AM IST */
exports.sendBirthdayWishes = cron.schedule(
  '0 9 * * *',
  cronTasks.sendBirthdayWishes,
  { scheduled: false, timezone: 'Asia/Kolkata' }
);

/* 📅 MONTHLY CASUAL LEAVE ACCRUAL — 12:05 AM IST daily */
exports.creditProbationCompletionLeave = cron.schedule(
  '5 0 * * *',
  cronTasks.creditProbationCompletionLeave,
  { scheduled: false, timezone: 'Asia/Kolkata' }
);

/* 📊 MONTHLY ATTENDANCE REPORT — 1st of month, 1:00 AM IST */
exports.generateMonthlyReport = cron.schedule(
  '0 1 1 * *',
  cronTasks.generateMonthlyReport,
  { scheduled: false, timezone: 'Asia/Kolkata' }
);

/* ⏰ MORNING PUNCH-IN REMINDER — 9:50 AM IST */
exports.notifyMorningPunchIn = cron.schedule(
  '50 9 * * *',
  cronTasks.notifyMorningPunchIn,
  { scheduled: false, timezone: 'Asia/Kolkata' }
);

/* ⏰ EVENING PUNCH-OUT REMINDER — 5:55 PM IST */
exports.notifyEveningPunchOut = cron.schedule(
  '55 17 * * *',
  cronTasks.notifyEveningPunchOut,
  { scheduled: false, timezone: 'Asia/Kolkata' }
);

/* 🎉 CELEBRATION NOTIFICATIONS — 9:00 AM IST */
exports.sendCelebrationNotifications = cron.schedule(
  '03 14 * * *',
  cronTasks.sendCelebrationNotifications,
  { scheduled: false, timezone: 'Asia/Kolkata' }
);

// ───────────────────────────────────────────────
// Lifecycle
// ───────────────────────────────────────────────
exports.startCronJobs = async () => {
  try {
    if (scheduleCelebrationNotifications) {
      scheduleCelebrationNotifications();
    }

    const jobs = [
      exports.creditProbationCompletionLeave,
      exports.sendBirthdayWishes,
      exports.generateMonthlyReport,
      exports.notifyMorningPunchIn,
      exports.notifyEveningPunchOut,
      exports.sendCelebrationNotifications,
    ];

    jobs.forEach((job) => job.start());
    console.log(`✅ Cron jobs started (${jobs.length} active)`);
  } catch (error) {
    console.error('❌ Failed to start cron jobs:', error);
  }
};

exports.stopCronJobs = () => {
  const jobs = [
    exports.creditProbationCompletionLeave,
    exports.sendBirthdayWishes,
    exports.generateMonthlyReport,
    exports.notifyMorningPunchIn,
    exports.notifyEveningPunchOut,
    exports.sendCelebrationNotifications,
  ];
  jobs.forEach((job) => job.stop());
  console.log('🛑 Cron jobs stopped');
};

exports.getCronStatus = () => {
  const jobs = [
    { name: 'creditProbationCompletionLeave', task: exports.creditProbationCompletionLeave },
    { name: 'sendBirthdayWishes', task: exports.sendBirthdayWishes },
    { name: 'generateMonthlyReport', task: exports.generateMonthlyReport },
    { name: 'notifyMorningPunchIn', task: exports.notifyMorningPunchIn },
    { name: 'notifyEveningPunchOut', task: exports.notifyEveningPunchOut },
    { name: 'sendCelebrationNotifications', task: exports.sendCelebrationNotifications },
  ];

  return jobs.map((job) => ({
    name: job.name,
    isRunning: job.task.getStatus() === 'started',
    nextRun: job.task.nextDate(),
  }));
};

exports.cronTasks = cronTasks;