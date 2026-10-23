// utils/assetNotifications.js
const { sendNotification } = require('../firebase/notificationService');

/**
 * Notify employee when an asset is assigned
 */
async function notifyAssetAssigned(employeeId, asset) {
  await sendNotification(employeeId, {
    title: '💼 New Asset Assigned',
    body: `You have been assigned the asset: "${asset.name}"`,
    data: {
      type: 'asset',
      action: 'assigned',
      assetId: asset._id.toString(),
    },
  });
}

/**
 * Notify employee when an asset is returned (optional, e.g., manager/admin)
 */
async function notifyAssetReturned(employeeId, asset) {
  await sendNotification(employeeId, {
    title: '💼 Asset Returned',
    body: `The asset "${asset.name}" has been returned.`,
    data: {
      type: 'asset',
      action: 'returned',
      assetId: asset._id.toString(),
    },
  });
}

/**
 * Notify employee when asset status changes
 */
async function notifyAssetStatusChanged(employeeId, asset) {
  await sendNotification(employeeId, {
    title: '💼 Asset Status Updated',
    body: `The asset "${asset.name}" status has been changed to "${asset.status}".`,
    data: {
      type: 'asset',
      action: 'status_changed',
      assetId: asset._id.toString(),
      status: asset.status
    },
  });
}

module.exports = {
  notifyAssetAssigned,
  notifyAssetReturned,
  notifyAssetStatusChanged,
};
