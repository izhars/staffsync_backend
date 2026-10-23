// utils/celebrationNotifications.js
const { sendNotification } = require('../firebase/notificationService');
const User = require('../models/User');

/**
 * Send birthday notification to the employee
 */
async function notifyBirthdayPerson(userId, yearsOld) {
  const user = await User.findById(userId).select('firstName fullName');
  const firstName = user?.firstName || 'Team Member';
  
  await sendNotification(userId, {
    title: '🎂 Happy Birthday! 🎉',
    body: `Wishing you a fantastic birthday, ${firstName}! May your day be filled with joy and happiness!`,
    data: {
      type: 'celebration',
      action: 'birthday_personal',
      celebrationType: 'birthday',
      yearsOld: yearsOld.toString(),
    },
  });
}

/**
 * Send birthday announcement to all employees
 */
async function notifyBirthdayAnnouncement(birthdayPersonId, birthdayPersonName, yearsOld) {
  const employees = await User.find({ 
    isActive: true, 
    role: 'employee',
    _id: { $ne: birthdayPersonId } // Don't send to the birthday person
  }).select('_id');

  for (const emp of employees) {
    await sendNotification(emp._id, {
      title: '🎉 Birthday Alert!',
      body: `Today is ${birthdayPersonName}'s birthday! ${yearsOld ? `They're turning ${yearsOld}!` : 'Wish them a happy birthday!'}`,
      data: {
        type: 'celebration',
        action: 'birthday_announcement',
        celebrationType: 'birthday',
        personId: birthdayPersonId.toString(),
        personName: birthdayPersonName,
      },
    });
  }
}

/**
 * Send work anniversary notification to the employee
 */
async function notifyWorkAnniversaryPerson(userId, yearsOfService) {
  const user = await User.findById(userId).select('firstName fullName');
  const firstName = user?.firstName || 'Team Member';
  
  await sendNotification(userId, {
    title: '🏆 Work Anniversary! 🎊',
    body: `Congratulations on ${yearsOfService} amazing ${yearsOfService === 1 ? 'year' : 'years'} with us, ${firstName}! Thank you for your dedication!`,
    data: {
      type: 'celebration',
      action: 'work_anniversary_personal',
      celebrationType: 'work_anniversary',
      years: yearsOfService.toString(),
    },
  });
}

/**
 * Send work anniversary announcement to all employees
 */
async function notifyWorkAnniversaryAnnouncement(employeeId, employeeName, yearsOfService) {
  const employees = await User.find({ 
    isActive: true, 
    role: 'employee',
    _id: { $ne: employeeId } // Don't send to the employee themselves
  }).select('_id');

  for (const emp of employees) {
    await sendNotification(emp._id, {
      title: '🎊 Work Milestone!',
      body: `${employeeName} is celebrating ${yearsOfService} ${yearsOfService === 1 ? 'year' : 'years'} with the company today! Let's congratulate them!`,
      data: {
        type: 'celebration',
        action: 'work_anniversary_announcement',
        celebrationType: 'work_anniversary',
        personId: employeeId.toString(),
        personName: employeeName,
        years: yearsOfService.toString(),
      },
    });
  }
}

/**
 * Send marriage anniversary notification to the employee
 */
async function notifyMarriageAnniversaryPerson(userId, yearsOfMarriage) {
  const user = await User.findById(userId).select('firstName fullName spouseDetails');
  const firstName = user?.firstName || 'Team Member';
  const spouseName = user?.spouseDetails?.name || 'your spouse';
  
  await sendNotification(userId, {
    title: '💖 Happy Anniversary! ❤️',
    body: `Wishing you and ${spouseName} a beautiful ${yearsOfMarriage}${getOrdinalSuffix(yearsOfMarriage)} marriage anniversary, ${firstName}! May love continue to blossom!`,
    data: {
      type: 'celebration',
      action: 'marriage_anniversary_personal',
      celebrationType: 'marriage_anniversary',
      years: yearsOfService.toString(),
    },
  });
}

/**
 * Send marriage anniversary announcement to all employees
 */
async function notifyMarriageAnniversaryAnnouncement(employeeId, employeeName, spouseName, yearsOfMarriage) {
  const employees = await User.find({ 
    isActive: true, 
    role: 'employee',
    _id: { $ne: employeeId }
  }).select('_id');

  for (const emp of employees) {
    await sendNotification(emp._id, {
      title: '💕 Anniversary Celebration!',
      body: `${employeeName} is celebrating ${yearsOfMarriage} ${yearsOfMarriage === 1 ? 'year' : 'years'} of marriage${spouseName ? ` with ${spouseName}` : ''}! Send your warm wishes!`,
      data: {
        type: 'celebration',
        action: 'marriage_anniversary_announcement',
        celebrationType: 'marriage_anniversary',
        personId: employeeId.toString(),
        personName: employeeName,
        spouseName: spouseName || '',
        years: yearsOfMarriage.toString(),
      },
    });
  }
}

/**
 * Helper function for ordinal suffixes (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(number) {
  if (number % 100 >= 11 && number % 100 <= 13) return 'th';
  switch (number % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

module.exports = {
  notifyBirthdayPerson,
  notifyBirthdayAnnouncement,
  notifyWorkAnniversaryPerson,
  notifyWorkAnniversaryAnnouncement,
  notifyMarriageAnniversaryPerson,
  notifyMarriageAnniversaryAnnouncement,
};