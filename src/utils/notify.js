
const { sendPushToUser } = require('../firebase/notificationService');

/**
 * Send a notification to one user, swallowing all errors.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function notifyUser(userId, { title, body, type = 'general', link, data = {} } = {}) {
  if (!userId) return { ok: false, reason: 'no_user' };

  try {
    const result = await sendPushToUser(userId, {
      title,
      body,
      data: { ...data, type, ...(link ? { link } : {}) },
    });

    if (!result?.success) {
      console.warn(
        `[notify] not delivered to ${userId}: ${result?.reason || 'unknown'}` +
        (result?.failureCount ? ` (failures: ${result.failureCount})` : '')
      );
    }

    return { ok: !!result?.success, reason: result?.reason };
  } catch (err) {
    console.error(`[notify] failed for ${userId}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Send the same notification to many users. Failures are isolated per user.
 * @returns {Promise<{sent:number, failed:number}>}
 */
async function notifyUsers(userIds = [], payload = {}) {
  const unique = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (unique.length === 0) return { sent: 0, failed: 0 };

  const results = await Promise.allSettled(
    unique.map((id) => notifyUser(id, payload))
  );

  let sent = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.ok) sent++;
    else failed++;
  }

  if (failed > 0) {
    console.warn(`[notify] "${payload.title}" → ${sent} sent, ${failed} not delivered`);
  }

  return { sent, failed };
}

/**
 * Fire a notification without awaiting it. Use when the caller must not wait
 * on push delivery (e.g. inside a request handler).
 */
function notifyInBackground(userId, payload) {
  notifyUser(userId, payload).catch(() => {});
}

module.exports = { notifyUser, notifyUsers, notifyInBackground };
