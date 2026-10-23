const { sendNotification } = require('../firebase/notificationService'); // your FCM helper

/**
 * Send leave approved notification
 */
async function notifyLeaveApproved(leave) {
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  const start = leave.startDate.toLocaleDateString('en-US', options);
  const end = leave.endDate.toLocaleDateString('en-US', options);

  await sendNotification(leave.employee, {
    title: 'Leave Approved ✅',
    body: `Your leave from ${start} to ${end} has been approved`,
    data: {
      type: 'leave',
      action: 'approved',
      leaveId: leave._id.toString(),
    },
  });
}


/**
 * Send leave rejected notification
 */
async function notifyLeaveRejected(leave, reason = null) {
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  const start = leave.startDate.toLocaleDateString('en-US', options);
  const end = leave.endDate.toLocaleDateString('en-US', options);

  const body = reason 
    ? `Your leave from ${start} to ${end} was rejected. Reason: ${reason}`
    : `Your leave from ${start} to ${end} was rejected`;

  await sendNotification(leave.employee, {
    title: 'Leave Rejected ❌',
    body,
    data: {
      type: 'leave_update',
      action: 'rejected',
      leaveId: leave._id.toString(),
      status: 'rejected',
      ...(reason && { reason }),
    },
  });
}

/**
 * Send new leave request notification to HR/Admin
 */
async function notifyNewLeaveRequest(hrUserId, leave, employeeName) {
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  const start = leave.startDate.toLocaleDateString('en-US', options);
  const end = leave.endDate.toLocaleDateString('en-US', options);

  await sendNotification(hrUserId, {
    title: 'New Leave Request 📝',
    body: `${employeeName} requested ${leave.leaveType} leave from ${start} to ${end}`,
    data: {
      type: 'leave',
      action: 'requested',
      leaveId: leave._id.toString(),
      employeeId: leave.employee.toString(),
    },
  });
}

module.exports = {
  notifyLeaveApproved,
  notifyLeaveRejected,
  notifyNewLeaveRequest,
};