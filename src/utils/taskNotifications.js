// utils/taskNotifications.js
const { sendNotification } = require('../firebase/notificationService');

/**
 * Notify a user about a new task
 */
async function notifyTaskAssigned(assigneeId, task) {
  await sendNotification(assigneeId, {
    title: '📝 New Task Assigned',
    body: `You have been assigned a new task: "${task.title}"`,
    data: {
      type: 'task',
      action: 'assigned',
      taskId: task._id.toString(),
    },
  });
}

/**
 * Notify a user about a task update
 */
async function notifyTaskUpdated(assigneeId, task) {
  await sendNotification(assigneeId, {
    title: '✏️ Task Updated',
    body: `Task "${task.title}" has been updated.`,
    data: {
      type: 'task',
      action: 'updated',
      taskId: task._id.toString(),
    },
  });
}

/**
 * Notify a user that a task is completed
 */
async function notifyTaskCompleted(assigneeId, task) {
  await sendNotification(assigneeId, {
    title: '✅ Task Completed',
    body: `Task "${task.title}" has been marked as completed.`,
    data: {
      type: 'task',
      action: 'completed',
      taskId: task._id.toString(),
    },
  });
}

// utils/taskNotifications.js
async function notifyTaskComment(task, commenterId) {
  const assigneeId = task.assignee?._id || task.assignee;
  if (assigneeId.toString() === commenterId.toString()) return; // Skip if commenter is the assignee

  await sendNotification(assigneeId, {
    title: '💬 New Comment on Task',
    body: `Someone commented on task "${task.title}"`,
    data: {
      type: 'task',
      action: 'commented',
      taskId: task._id.toString(),
      commenterId: commenterId.toString(),
    },
  });
}

module.exports = {
  notifyTaskAssigned,
  notifyTaskUpdated,
  notifyTaskCompleted,
  notifyTaskComment
};
