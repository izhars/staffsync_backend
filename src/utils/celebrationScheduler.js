// utils/celebrationScheduler.js
const cron = require('node-cron');
const moment = require('moment-timezone');
const User = require('../models/User');
const {
  notifyBirthdayPerson,
  notifyBirthdayAnnouncement,
  notifyWorkAnniversaryPerson,
  notifyWorkAnniversaryAnnouncement,
  notifyMarriageAnniversaryPerson,
  notifyMarriageAnniversaryAnnouncement,
} = require('./celebrationNotifications');
const { updateCronRun, getLastCronRun } = require('./cronLogger');

/**
 * Get today's celebrations (birthdays, anniversaries)
 */
async function getTodaysCelebrations() {
  const today = moment().tz('Asia/Kolkata');
  const month = today.month() + 1;
  const day = today.date();
  const year = today.year();

  const result = await User.aggregate([
    {
      $match: {
        isActive: true,
        role: 'employee',
        $or: [
          { dateOfBirth: { $exists: true, $ne: null } },
          { dateOfJoining: { $exists: true, $ne: null } },
          { marriageAnniversary: { $exists: true, $ne: null } }
        ]
      }
    },
    {
      $addFields: {
        birthMonth: { $month: '$dateOfBirth' },
        birthDay: { $dayOfMonth: '$dateOfBirth' },
        joinMonth: { $month: '$dateOfJoining' },
        joinDay: { $dayOfMonth: '$dateOfJoining' },
        marriageMonth: { $month: '$marriageAnniversary' },
        marriageDay: { $dayOfMonth: '$marriageAnniversary' }
      }
    },
    {
      $project: {
        _id: 1,
        employeeId: 1,
        firstName: 1,
        fullName: 1,
        email: 1,
        dateOfBirth: 1,
        dateOfJoining: 1,
        marriageAnniversary: 1,
        maritalStatus: 1,
        spouseDetails: 1,
        hasBirthday: {
          $and: [
            { $eq: ['$birthMonth', month] },
            { $eq: ['$birthDay', day] }
          ]
        },
        hasWorkAnniversary: {
          $and: [
            { $eq: ['$joinMonth', month] },
            { $eq: ['$joinDay', day] }
          ]
        },
        hasMarriageAnniversary: {
          $and: [
            { $eq: ['$marriageMonth', month] },
            { $eq: ['$marriageDay', day] },
            { $eq: ['$maritalStatus', 'married'] }
          ]
        }
      }
    },
    {
      $match: {
        $or: [
          { hasBirthday: true },
          { hasWorkAnniversary: true },
          { hasMarriageAnniversary: true }
        ]
      }
    }
  ]);

  return result.map(user => {
    const celebrations = [];
    
    if (user.hasBirthday) {
      const birthYear = moment(user.dateOfBirth).year();
      const age = year - birthYear;
      celebrations.push({
        type: 'birthday',
        age: age,
        message: `Turning ${age} today`
      });
    }
    
    if (user.hasWorkAnniversary) {
      const joinYear = moment(user.dateOfJoining).year();
      const yearsOfService = year - joinYear;
      celebrations.push({
        type: 'work_anniversary',
        years: yearsOfService,
        message: `${yearsOfService} year${yearsOfService === 1 ? '' : 's'} of service`
      });
    }
    
    if (user.hasMarriageAnniversary) {
      const marriageYear = moment(user.marriageAnniversary).year();
      const yearsOfMarriage = year - marriageYear;
      celebrations.push({
        type: 'marriage_anniversary',
        years: yearsOfMarriage,
        message: `${yearsOfMarriage} year${yearsOfMarriage === 1 ? '' : 's'} of marriage`
      });
    }
    
    return {
      ...user,
      celebrations
    };
  });
}

/**
 * Main function to send celebration notifications
 */
async function sendCelebrationNotifications() {
  try {
    await updateCronRun('sendCelebrationNotifications');

    const celebrants = await getTodaysCelebrations();
    
    if (celebrants.length === 0) {
      return { success: true, count: 0, message: 'No celebrations today' };
    }

    let personalNotifications = 0;
    let announcementNotifications = 0;

    for (const celebrant of celebrants) {
      try {
        // Send personal notifications
        for (const celebration of celebrant.celebrations) {
          if (celebration.type === 'birthday') {
            await notifyBirthdayPerson(celebrant._id, celebration.age);
            personalNotifications++;
            
            await notifyBirthdayAnnouncement(
              celebrant._id, 
              celebrant.fullName, 
              celebration.age
            );
            announcementNotifications++;
          }
          else if (celebration.type === 'work_anniversary') {
            await notifyWorkAnniversaryPerson(celebrant._id, celebration.years);
            personalNotifications++;
            
            await notifyWorkAnniversaryAnnouncement(
              celebrant._id,
              celebrant.fullName,
              celebration.years
            );
            announcementNotifications++;
          }
          else if (celebration.type === 'marriage_anniversary') {
            const spouseName = celebrant.spouseDetails?.name || null;
            await notifyMarriageAnniversaryPerson(celebrant._id, celebration.years);
            personalNotifications++;
            
            await notifyMarriageAnniversaryAnnouncement(
              celebrant._id,
              celebrant.fullName,
              spouseName,
              celebration.years
            );
            announcementNotifications++;
          }
        }
      } catch (error) {
        console.error(`❌ Failed to send notifications for ${celebrant.fullName}:`, error.message);
      }
    }

    // Send summary notification to HR/Admin
    await sendCelebrationSummaryToAdmin(celebrants);

    return {
      success: true,
      count: celebrants.length,
      personalNotifications,
      announcementNotifications,
      totalNotifications: personalNotifications + announcementNotifications,
      message: `Celebration notifications sent to ${celebrants.length} employee(s)`
    };
  } catch (error) {
    console.error('❌ Error in celebration notifications cron:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send summary of today's celebrations to HR/Admin
 */
async function sendCelebrationSummaryToAdmin(celebrants) {
  try {
    // Find HR and Admin users
    const hrAdmins = await User.find({
      isActive: true,
      role: { $in: ['hr', 'superadmin', 'admin'] }
    }).select('_id firstName');

    if (hrAdmins.length === 0) return;

    const birthdayCount = celebrants.filter(c => c.celebrations.some(celeb => celeb.type === 'birthday')).length;
    const workAnniversaryCount = celebrants.filter(c => c.celebrations.some(celeb => celeb.type === 'work_anniversary')).length;
    const marriageAnniversaryCount = celebrants.filter(c => c.celebrations.some(celeb => celeb.type === 'marriage_anniversary')).length;

    for (const admin of hrAdmins) {
      await sendNotification(admin._id, {
        title: '📅 Today\'s Celebrations Summary',
        body: `🎂 ${birthdayCount} birthday(s) | 🏆 ${workAnniversaryCount} work anniversary(s) | 💖 ${marriageAnniversaryCount} marriage anniversary(s)`,
        data: {
          type: 'celebration',
          action: 'daily_summary',
          birthdayCount: birthdayCount.toString(),
          workAnniversaryCount: workAnniversaryCount.toString(),
          marriageAnniversaryCount: marriageAnniversaryCount.toString(),
          total: celebrants.length.toString()
        },
      });
    }
  } catch (error) {
    console.error('❌ Error sending summary to admin:', error);
  }
}

/**
 * Schedule celebration notifications
 */
function scheduleCelebrationNotifications() {
  // Send at 9:00 AM IST every day
  const job = cron.schedule(
    '0 9 * * *',
    sendCelebrationNotifications,
    {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    }
  );

  // Optional: Send reminder at 3:00 PM for those who haven't wished
  const reminderJob = cron.schedule(
    '0 15 * * *',
    async () => {
      // You can add logic to send reminder notifications
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    }
  );

  return { job, reminderJob };
}

module.exports = {
  sendCelebrationNotifications,
  scheduleCelebrationNotifications,
  getTodaysCelebrations,
};