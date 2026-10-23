const { notifyUser } = require('./notify');
const { createNotificationDirect } = require('../firebase/notificationService');

/**
 * Send a security notification to a user.
 *
 * @param {Object}   p
 * @param {any}      p.userId   recipient
 * @param {string}   p.title
 * @param {string}   p.body
 * @param {string}   p.action   machine-readable action, e.g. 'password_changed'
 * @param {Object}   [p.extra]  additional data payload
 */
async function notifySecurityEvent({ userId, title, body, action, extra = {} }) {
  return notifyUser(userId, {
    title,
    body,
    type: 'security',
    data: { action, ...extra },
  });
}

/**
 * Persist a security notification **and** push it.
 *
 * Use this when the target device may have just been unregistered (device
 * reset) or is otherwise unreachable, so the notice still appears in the
 * user's in-app notification list once they return.
 */
async function recordSecurityEvent({ userId, title, body, action, extra = {} }) {
  if (!userId) return { ok: false, reason: 'no_user' };

  try {
    const result = await createNotificationDirect(
      {
        userIds: [userId],
        roles: [],
        title,
        message: body,
        type: 'security',
        link: null,
        meta: { action, ...extra },
      },
      null
    );
    return { ok: true, created: result?.docs?.length ?? 0 };
  } catch (err) {
    console.error(`[security] failed to record event for ${userId}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

/** Password changed (self-service or reset flow). */
async function notifyPasswordChanged(userId, { via = 'profile' } = {}) {
  return notifySecurityEvent({
    userId,
    title: '🔑 Password Changed',
    body: `Your password was changed (${via}). If this wasn't you, contact HR immediately.`,
    action: 'password_changed',
    extra: { via },
  });
}

/** HR reset the user's bound device / active session. */
async function notifyDeviceReset(userId) {
  return recordSecurityEvent({
    userId,
    title: '📱 Device Access Reset',
    body: 'Your device access was reset by HR. Please log in again to continue.',
    action: 'device_reset',
  });
}

/** Account verification status flipped by HR. */
async function notifyVerificationChanged(userId, isVerified) {
  return notifySecurityEvent({
    userId,
    title: isVerified ? '✅ Account Verified' : '⚠️ Account Unverified',
    body: isVerified
      ? 'Your account has been verified. You can now log in.'
      : 'Your account verification was removed. Please contact HR.',
    action: 'verification_changed',
    extra: { isVerified: String(isVerified) },
  });
}

module.exports = {
  notifySecurityEvent,
  recordSecurityEvent,
  notifyPasswordChanged,
  notifyDeviceReset,
  notifyVerificationChanged,
};
