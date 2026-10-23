// utils/announcementNotifications.js
const User = require('../models/User');
const { sendNotification } = require('../firebase/notificationService');

async function notifyAnnouncementToAudience(announcement) {
  let users = [];
  const { targetAudience } = announcement;

  if (targetAudience.type === 'all') {
    users = await User.find({ isActive: true }).select('_id');
  }

  if (targetAudience.type === 'employees') {
    users = await User.find({ _id: { $in: targetAudience.employees } }).select('_id');
  }

  if (targetAudience.type === 'departments') {
    users = await User.find({ department: { $in: targetAudience.departments } }).select('_id');
  }

  const userIds = users.map(u => u._id);

  await Promise.all(
    userIds.map(userId =>
      sendNotification(userId, {
        title: `📢 ${announcement.title}`,
        body: announcement.description,
        data: {
          type: 'announcement',
          announcementId: announcement._id.toString(),
        },
      })
    )
  );
}

module.exports = { notifyAnnouncementToAudience };
