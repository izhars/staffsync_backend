// utils/celebrationEmailService.js
const User = require('../models/User');
const emailService = require('../services/emailService');
const moment = require('moment-timezone');
const { ADMIN_ROLES } = require('../constants/roles');

const COMPANY_NAME = process.env.COMPANY_NAME || 'HRMS';
const TIMEZONE = 'Asia/Kolkata';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Check if today matches a given date's month & day (ignoring year)
 */
function isDateToday(date, today) {
  if (!date) return false;
  const d = moment(date).tz(TIMEZONE);
  return d.month() === today.month() && d.date() === today.date();
}

/**
 * Calculate years between two dates
 */
function yearsBetween(from, to = new Date()) {
  return moment(to).diff(moment(from), 'years');
}

/**
 * Format date nicely
 */
function formatDate(date) {
  return moment(date).tz(TIMEZONE).format('DD MMMM YYYY');
}

/**
 * Get label like "1 Year", "2 Years", etc.
 */
function yearLabel(years) {
  return years === 1 ? 'Year' : 'Years';
}

// ────────────────────────────────────────────────────────────────
// Send Birthday Email
// ────────────────────────────────────────────────────────────────
async function sendBirthdayEmail(user) {
  try {
    const html = await emailService.loadTemplate('celebration-birthday.html', {
      firstName: user.firstName,
      lastName: user.lastName,
      employeeId: user.employeeId,
      companyName: COMPANY_NAME,
      year: new Date().getFullYear(),
    });

    const result = await emailService.sendEmail({
      to: user.email,
      subject: `🎂 Happy Birthday, ${user.firstName}! 🎉`,
      html,
    });

    console.log(`✅ Birthday email sent to ${user.email}`);
    return { success: true, user: user.employeeId, ...result };
  } catch (error) {
    console.error(`❌ Birthday email failed for ${user.email}:`, error.message);
    return { success: false, user: user.employeeId, error: error.message };
  }
}

// ────────────────────────────────────────────────────────────────
// Send Work Anniversary Email
// ────────────────────────────────────────────────────────────────
async function sendWorkAnniversaryEmail(user) {
  try {
    const years = yearsBetween(user.dateOfJoining);
    if (years < 1) return { success: false, reason: 'Less than 1 year' };

    const daysSinceJoining = moment().diff(moment(user.dateOfJoining), 'days');

    const html = await emailService.loadTemplate('celebration-work-anniversary.html', {
      firstName: user.firstName,
      lastName: user.lastName,
      employeeId: user.employeeId,
      designation: user.designation || 'Team Member',
      years,
      yearLabel: yearLabel(years),
      daysSinceJoining,
      joiningDate: formatDate(user.dateOfJoining),
      companyName: COMPANY_NAME,
      year: new Date().getFullYear(),
    });

    const result = await emailService.sendEmail({
      to: user.email,
      subject: `🏆 Congratulations on ${years} ${yearLabel(years)} at ${COMPANY_NAME}! 🎊`,
      html,
    });

    console.log(`✅ Work anniversary email sent to ${user.email} (${years} years)`);
    return { success: true, user: user.employeeId, years, ...result };
  } catch (error) {
    console.error(`❌ Work anniversary email failed for ${user.email}:`, error.message);
    return { success: false, user: user.employeeId, error: error.message };
  }
}

// ────────────────────────────────────────────────────────────────
// Send Marriage Anniversary Email
// ────────────────────────────────────────────────────────────────
async function sendMarriageAnniversaryEmail(user) {
  try {
    if (!user.marriageAnniversary || user.maritalStatus !== 'married') {
      return { success: false, reason: 'Not married / no anniversary date' };
    }

    const years = yearsBetween(user.marriageAnniversary);
    if (years < 1) return { success: false, reason: 'Less than 1 year married' };

    const html = await emailService.loadTemplate('celebration-marriage-anniversary.html', {
      firstName: user.firstName,
      lastName: user.lastName,
      employeeId: user.employeeId,
      years,
      yearLabel: yearLabel(years),
      anniversaryDate: formatDate(user.marriageAnniversary),
      spouseName: user.spouseDetails?.name || 'your partner',
      companyName: COMPANY_NAME,
      year: new Date().getFullYear(),
    });

    const result = await emailService.sendEmail({
      to: user.email,
      subject: `💐 Happy ${years}${years === 1 ? 'st' : years === 2 ? 'nd' : years === 3 ? 'rd' : 'th'} Wedding Anniversary, ${user.firstName}! 💕`,
      html,
    });

    console.log(`✅ Marriage anniversary email sent to ${user.email} (${years} years)`);
    return { success: true, user: user.employeeId, years, ...result };
  } catch (error) {
    console.error(`❌ Marriage anniversary email failed for ${user.email}:`, error.message);
    return { success: false, user: user.employeeId, error: error.message };
  }
}

// ────────────────────────────────────────────────────────────────
// Master Function — Send All Celebration Emails for Today
// ────────────────────────────────────────────────────────────────
async function sendAllCelebrationEmails() {
  const today = moment().tz(TIMEZONE);
  const results = {
    birthdays: [],
    workAnniversaries: [],
    marriageAnniversaries: [],
    errors: [],
  };

  try {
    // Fetch all active non-admin users
    const users = await User.find({
      isActive: true,
      role: { $nin: ADMIN_ROLES },
      email: { $exists: true, $ne: null },
    }).select(
      'firstName lastName email employeeId dateOfJoining dateOfBirth ' +
      'marriageAnniversary maritalStatus spouseDetails designation'
    );

    console.log(`🔍 Checking ${users.length} employees for celebrations on ${today.format('DD MMM YYYY')}...`);

    for (const user of users) {
      try {
        // Birthday
        if (isDateToday(user.dateOfBirth, today)) {
          const r = await sendBirthdayEmail(user);
          results.birthdays.push(r);
        }

        // Work Anniversary (skip if joined less than 1 year ago)
        if (
          user.dateOfJoining &&
          isDateToday(user.dateOfJoining, today) &&
          yearsBetween(user.dateOfJoining) >= 1
        ) {
          const r = await sendWorkAnniversaryEmail(user);
          results.workAnniversaries.push(r);
        }

        // Marriage Anniversary
        if (
          user.maritalStatus === 'married' &&
          user.marriageAnniversary &&
          isDateToday(user.marriageAnniversary, today) &&
          yearsBetween(user.marriageAnniversary) >= 1
        ) {
          const r = await sendMarriageAnniversaryEmail(user);
          results.marriageAnniversaries.push(r);
        }
      } catch (err) {
        results.errors.push({ employeeId: user.employeeId, error: err.message });
      }
    }

    const summary = {
      success: true,
      date: today.format('YYYY-MM-DD'),
      totalChecked: users.length,
      birthdaysSent: results.birthdays.filter(r => r.success).length,
      workAnniversariesSent: results.workAnniversaries.filter(r => r.success).length,
      marriageAnniversariesSent: results.marriageAnniversaries.filter(r => r.success).length,
      errors: results.errors.length,
    };

    console.log('🎉 Celebration email summary:', summary);
    return { ...summary, details: results };
  } catch (error) {
    console.error('❌ sendAllCelebrationEmails failed:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendBirthdayEmail,
  sendWorkAnniversaryEmail,
  sendMarriageAnniversaryEmail,
  sendAllCelebrationEmails,
};