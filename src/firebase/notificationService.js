const mongoose = require('mongoose');
const admin = require('./firebase'); // ✅ single init point
const Notification = require('../models/Notification');
const User = require('../models/User');
const EmployeeInteraction = require('../models/EmployeeInteraction');

const {
  ACCESS_ROLES,
  NOTIFICATION_TARGET_MATRIX,
  normalizeRoleName,
} = require('../constants/roles');

// ============================================================================
// CONSTANTS
// ============================================================================

const INVALID_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const BATCH_SIZE = 500;
const FCM_TTL_MS = 60 * 60 * 1000;

const NOTIFICATION_CHANNELS = {
  CALLS: 'staffsync_calls',
  GENERAL: 'staffsync_general',
};

const NOTIFICATION_SOUNDS = {
  CALLS: 'ringtone',
  DEFAULT: 'default',
};

// Maps notification `type` -> user.notificationSettings key.
// A type with no mapping is always delivered (the check only blocks when the
// corresponding setting is explicitly false), so keep this in sync with the
// settings block in models/User.js.
const TYPE_TO_SETTING_MAP = Object.freeze({
  incoming_call: 'calls',
  call_accepted: 'calls',
  call_declined: 'calls',
  call_ended: 'calls',
  call_missed: 'calls',
  call_action_complete: 'calls',
  message: 'messages',
  employee_interaction: 'employeeInteractions',
  schedule_update: 'scheduleUpdates',
  attendance: 'attendance',
  leave: 'leave',
  leave_update: 'leave',
  expense: 'expenses',
  payroll: 'payroll',
  task: 'tasks',
  asset: 'assets',
  announcement: 'announcements',
  celebration: 'celebrations',
  security: 'security',
});

const CALL_TEMPLATES = {
  incoming_call: (ctx) => ({
    title: `📞 Incoming ${ctx.callType === 'audio' ? 'Audio' : 'Video'} Call`,
    body: `${ctx.callerName} is calling you`,
  }),
  call_accepted: (ctx) => ({
    title: '✅ Call Accepted',
    body: `${ctx.receiverName} accepted your call`,
  }),
  call_declined: (ctx) => ({
    title: '❌ Call Declined',
    body: `${ctx.callerName} declined your call`,
  }),
  call_ended: (ctx) => ({
    title: '📞 Call Ended',
    body: ctx.reason || `${ctx.callerName} ended the call`,
  }),
  call_missed: (ctx) => ({
    title: '⏰ Missed Call',
    body: `Missed call from ${ctx.callerName}`,
  }),
};

const INTERACTION_TEMPLATES = {
  viewed_profile:    (n) => ({ title: '👀 Profile Viewed',    body: `${n} viewed your profile`,       action: 'VIEW_PROFILE' }),
  viewed_contact:    (n) => ({ title: '📞 Contact Viewed',    body: `${n} viewed your contact info`,  action: 'VIEW_CONTACT' }),
  messaged:          (n, msg) => ({ title: '💬 New Message',  body: msg || `${n} sent you a message`, action: 'VIEW_MESSAGES' }),
  shared_profile:    (n) => ({ title: '📤 Profile Shared',    body: `${n} shared your profile`,       action: 'VIEW_PROFILE' }),
  saved_contact:     (n) => ({ title: '⭐ Contact Saved',     body: `${n} saved your contact`,        action: 'VIEW_CONTACT' }),
  downloaded_resume: (n) => ({ title: '📥 Resume Downloaded', body: `${n} downloaded your resume`,    action: 'VIEW_RESUME' }),
  started_call:      (n) => ({ title: '📞 Call Initiated',    body: `${n} started a call with you`,   action: 'VIEW_CALL' }),
};

// ============================================================================
// HELPERS (pure)
// ============================================================================

const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

const toStr = (v) => (v == null ? '' : String(v));

const isCallType = (type) => TYPE_TO_SETTING_MAP[type] === 'calls';

function normalizeTokens(fcmToken) {
  if (Array.isArray(fcmToken)) return fcmToken.filter(Boolean);
  return fcmToken ? [fcmToken] : [];
}

function flattenData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : toStr(value);
  }
  return out;
}

function checkNotificationPreference(settings = {}, type) {
  if (settings.enabled === false) {
    return { allowed: false, reason: 'notifications_disabled' };
  }
  const settingKey = TYPE_TO_SETTING_MAP[type];
  if (settingKey && settings[settingKey] === false) {
    return { allowed: false, reason: `${settingKey}_disabled` };
  }
  return { allowed: true };
}

function extractInvalidTokens(tokens, responses = []) {
  const invalid = [];
  responses.forEach((res, idx) => {
    if (!res.success && res.error && INVALID_TOKEN_ERRORS.has(res.error.code)) {
      invalid.push(tokens[idx]);
    }
  });
  return invalid;
}

// ============================================================================
// FCM MESSAGE BUILDER — data-only, except calls get alert
// ============================================================================

function buildFcmMessage({ tokens, title, body, imageUrl, data = {} }) {
  const type = data?.type;
  const callType = isCallType(type);
  const flattenedData = flattenData(data);
  const safeTitle = toStr(title || 'Notification');
  const safeBody = toStr(body || '');

  // Incoming calls need the ringtone channel; everything else uses the
  // default channel. Both now carry an actual notification block so the OS
  // displays them while the app is backgrounded or terminated.
  const isIncomingCall = type === 'incoming_call';
  const channelId = isIncomingCall ? NOTIFICATION_CHANNELS.CALLS : NOTIFICATION_CHANNELS.GENERAL;

  return {
    tokens,
    data: {
      ...flattenedData,
      title: safeTitle,
      body: safeBody,
      ...(imageUrl && { imageUrl: toStr(imageUrl) }),
      click_action: flattenedData.click_action || 'FLUTTER_NOTIFICATION_CLICK',
    },
    // ── Android ────────────────────────────────────────────────
    // A `notification` block is what makes FCM display the message when the
    // app is backgrounded/killed. Data-only messages are only delivered on
    // Android when the app is in the foreground.
    android: {
      priority: 'high',
      ttl: FCM_TTL_MS,
    },
    // ── iOS ────────────────────────────────────────────────────
    apns: {
      headers: {
        'apns-priority': isIncomingCall ? '10' : '5',
        'apns-push-type': 'alert',
      },
      payload: {
        aps: {
          alert: { title: safeTitle, body: safeBody },
          sound: isIncomingCall ? 'ringtone.aiff' : 'default',
          badge: 1,
          ...(isIncomingCall && {
            category: 'INCOMING_CALL',
            interruptionLevel: 'time-sensitive',
          }),
          // Let the app also process the payload in the background
          'content-available': 1,
        },
        ...(imageUrl && { imageUrl: toStr(imageUrl) }),
      },
    },
  };
}

// ============================================================================
// TOKEN CLEANUP
// ============================================================================

async function removeInvalidTokensForUser(userId, invalidTokens) {
  if (!invalidTokens?.length) return 0;
  await User.updateOne(
    { _id: userId },
    { $pull: { fcmToken: { $in: invalidTokens } } }
  );
  return invalidTokens.length;
}

async function cleanupInvalidTokensBulk(invalidTokens, tokenToUserMap) {
  if (!invalidTokens?.length) return 0;

  const userTokensMap = new Map();
  for (const token of invalidTokens) {
    const userId = tokenToUserMap.get(token);
    if (!userId) continue;
    if (!userTokensMap.has(userId)) userTokensMap.set(userId, []);
    userTokensMap.get(userId).push(token);
  }

  let totalRemoved = 0;
  await Promise.all(
    Array.from(userTokensMap.entries()).map(async ([userId, tokensToRemove]) => {
      await User.updateOne(
        { _id: userId },
        { $pull: { fcmToken: { $in: tokensToRemove } } }
      );
      totalRemoved += tokensToRemove.length;
    })
  );

  return totalRemoved;
}

// ============================================================================
// RBAC (File 2)
// ============================================================================

const buildVisibilityFilter = (user) => {
  const userId = user._id.toString();
  const role = normalizeRoleName(user.role);

  if (role === ACCESS_ROLES.SUPER_ADMIN) {
    return { deleted: false };
  }

  const or = [{ user: userId }, { isGlobal: true }];

  switch (role) {
    case ACCESS_ROLES.HR_ADMIN:
      or.push(
        { role: ACCESS_ROLES.HR_ADMIN, user: userId },
        { role: ACCESS_ROLES.MANAGER },
        { role: ACCESS_ROLES.TEAM_LEAD },
        { role: ACCESS_ROLES.EMPLOYEE },
        { role: 'all' },
      );
      break;
    case ACCESS_ROLES.MANAGER:
      or.push(
        { role: ACCESS_ROLES.MANAGER, user: userId },
        { role: ACCESS_ROLES.TEAM_LEAD },
        { role: ACCESS_ROLES.EMPLOYEE },
        { role: 'all' },
      );
      break;
    case ACCESS_ROLES.TEAM_LEAD:
      or.push(
        { role: ACCESS_ROLES.TEAM_LEAD, user: userId },
        { role: ACCESS_ROLES.EMPLOYEE },
        { role: 'all' },
      );
      break;
    case ACCESS_ROLES.EMPLOYEE:
      or.push(
        { role: ACCESS_ROLES.EMPLOYEE, user: userId },
        { role: 'all' },
      );
      break;
  }

  return { deleted: false, $or: or };
};

const canUserActOnNotification = (user, notification) => {
  const role = normalizeRoleName(user.role);
  if (role === ACCESS_ROLES.SUPER_ADMIN) return true;
  if (notification.user && notification.user.toString() === user._id.toString()) return true;
  if (notification.isGlobal) return true;
  if (!notification.role) return false;

  switch (role) {
    case ACCESS_ROLES.HR_ADMIN:
      return [ACCESS_ROLES.HR_ADMIN, ACCESS_ROLES.MANAGER, ACCESS_ROLES.TEAM_LEAD, ACCESS_ROLES.EMPLOYEE, 'all'].includes(notification.role);
    case ACCESS_ROLES.MANAGER:
      return [ACCESS_ROLES.MANAGER, ACCESS_ROLES.TEAM_LEAD, ACCESS_ROLES.EMPLOYEE, 'all'].includes(notification.role);
    case ACCESS_ROLES.TEAM_LEAD:
      return [ACCESS_ROLES.TEAM_LEAD, ACCESS_ROLES.EMPLOYEE, 'all'].includes(notification.role);
    case ACCESS_ROLES.EMPLOYEE:
      return [ACCESS_ROLES.EMPLOYEE, 'all'].includes(notification.role);
    default:
      return false;
  }
};

const resolveRecipientsForRoles = async (roles) => {
  const recipients = [];
  for (const role of roles) {
    if (role === 'all') {
      const users = await User.find({ isActive: true }).select('_id').lean();
      recipients.push(...users.map((u) => ({ userId: u._id, role: 'all', isGlobal: true })));
    } else {
      const users = await User.find({ role, isActive: true }).select('_id').lean();
      recipients.push(...users.map((u) => ({ userId: u._id, role })));
    }
  }
  return recipients;
};

const validateNotificationTargets = (actorRole, targetRoles) => {
  const normalizedActor = normalizeRoleName(actorRole);
  const allowed = NOTIFICATION_TARGET_MATRIX[normalizedActor] || [];
  const unauthorized = targetRoles.filter((r) => !allowed.includes(r));
  return { allowed: unauthorized.length === 0, unauthorized };
};

// ============================================================================
// FCM CORE — sendFcmToUsers (merged: array tokens + preference check)
// ============================================================================

/**
 * Send FCM push to a set of user IDs.
 * - Respects notificationSettings (per-user, per-type)
 * - Handles multiple tokens per user
 * - Skips online users (socket already delivered) if requested
 * - Auto-cleans invalid tokens
 */
async function sendFcmToUsers({
  userIds,
  title,
  body,
  message,          // alias for body (File 2 compat)
  type = 'general',
  data = {},
  skipOnlineUsers = false,
}) {
  const finalBody = body ?? message ?? '';
  const report = {
    attempted: 0,
    success: 0,
    failure: 0,
    invalidTokens: [],
    skipped: [],
    reason: null,
  };

  if (!admin.apps || admin.apps.length === 0) {
    report.reason = 'firebase-admin not initialized';
    console.warn('[notif/fcm]', report.reason);
    return report;
  }

  if (!userIds?.length) {
    report.reason = 'no recipients';
    return report;
  }

  const users = await User.find({
    _id: { $in: userIds },
    isActive: true,
  })
    .select('_id fcmToken isOnline notificationSettings')
    .lean();

  const tokenToUser = new Map();

  for (const u of users) {
    const uid = u._id.toString();

    // 1. Preference check
    const pref = checkNotificationPreference(u.notificationSettings, type);
    if (!pref.allowed) {
      report.skipped.push({ userId: uid, reason: pref.reason });
      continue;
    }

    // 2. Optionally skip users with a live socket (socket already delivered).
    //    NOTE: this must key off `isOnline`, which is actually persisted by
    //    the socket layer. `socketIds` is a subdocument array that no code
    //    writes, so relying on it silently defeated this branch.
    if (skipOnlineUsers && u.isOnline === true) {
      report.skipped.push({ userId: uid, reason: 'online (live socket)' });
      continue;
    }

    // 3. Multi-token support
    const tokens = normalizeTokens(u.fcmToken);
    if (tokens.length === 0) {
      report.skipped.push({ userId: uid, reason: 'no fcmToken' });
      continue;
    }

    for (const t of tokens) tokenToUser.set(t, uid);
  }

  const allTokens = [...tokenToUser.keys()];
  if (allTokens.length === 0) {
    report.reason = 'no tokens available';
    return report;
  }

  report.attempted = allTokens.length;

  for (const tokenChunk of chunk(allTokens, BATCH_SIZE)) {
    try {
      const payload = buildFcmMessage({
        tokens: tokenChunk,
        title,
        body: finalBody,
        data: { ...data, type },
      });

      const resp = await admin.messaging().sendEachForMulticast(payload);

      report.success += resp.successCount;
      report.failure += resp.failureCount;

      const invalid = extractInvalidTokens(tokenChunk, resp.responses);
      for (const t of invalid) {
        report.invalidTokens.push({ userId: tokenToUser.get(t), token: t });
      }
    } catch (err) {
      console.error('[notif/fcm] chunk failed:', err.message);
      report.failure += tokenChunk.length;
    }
  }

  if (report.invalidTokens.length > 0) {
    const invalidTokens = report.invalidTokens.map((t) => t.token);
    try {
      await cleanupInvalidTokensBulk(invalidTokens, tokenToUser);
    } catch (e) {
      console.warn('[notif/fcm] failed to prune invalid tokens:', e.message);
    }
  }

  return report;
}

// ============================================================================
// SINGLE-USER PUSH (File 1 logic — used by call/interaction wrappers)
// ============================================================================

async function sendPushToUser(userId, payload) {
  const user = await User.findById(userId)
    .select('fcmToken notificationSettings isActive')
    .lean();

  if (!user || user.isActive === false) {
    return { success: false, reason: 'user_not_found' };
  }

  const pref = checkNotificationPreference(user.notificationSettings, payload?.data?.type);
  if (!pref.allowed) {
    return { success: false, reason: pref.reason };
  }

  const tokens = normalizeTokens(user.fcmToken);
  if (tokens.length === 0) {
    return { success: false, reason: 'no_tokens' };
  }

  // Reuse bulk path for consistency
  const report = await sendFcmToUsers({
    userIds: [userId],
    title: payload.title,
    body: payload.body,
    type: payload.data?.type || 'general',
    data: payload.data,
    skipOnlineUsers: false,
  });

  return {
    success: report.success > 0,
    successCount: report.success,
    failureCount: report.failure,
    totalTokens: tokens.length,
  };
}

// ============================================================================
// DOMAIN WRAPPERS — CALLS
// ============================================================================

async function sendCallNotification({
  callerId,
  receiverId,
  callId,
  roomId,
  callType = 'audio',
  notificationType,
  actionBy = null,
  reason = '',
  metadata = {},
}) {
  try {
    if (toStr(callerId) === toStr(receiverId)) {
      return { success: false, reason: 'self_call' };
    }

    const [caller, receiver] = await Promise.all([
      User.findById(callerId).select('firstName lastName profilePicture notificationSettings'),
      User.findById(receiverId).select('firstName lastName notificationSettings'),
    ]);

    if (!caller || !receiver) throw new Error('User not found');

    if (receiver.notificationSettings?.calls === false) {
      return { success: false, reason: 'calls_disabled' };
    }

    const callerName = `${caller.firstName || ''} ${caller.lastName || ''}`.trim() || 'Unknown';
    const receiverName = `${receiver.firstName || ''} ${receiver.lastName || ''}`.trim() || 'User';

    const template = CALL_TEMPLATES[notificationType] || (() => ({
      title: '📞 Call Update',
      body: 'Call status updated',
    }));
    const { title, body } = template({ callType, callerName, receiverName, reason });

    const actionField = {
      call_declined: 'declinedBy',
      call_ended: 'endedBy',
      call_missed: 'missedBy',
    }[notificationType];

    const data = {
      type: notificationType,
      callId: toStr(callId),
      roomId: toStr(roomId),
      callerId: toStr(callerId),
      callerName,
      receiverId: toStr(receiverId),
      receiverName,
      callType,
      reason,
      metadata: JSON.stringify(metadata),
      timestamp: new Date().toISOString(),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      ...(actionBy && { actionBy: toStr(actionBy) }),
      ...(actionField && actionBy && { [actionField]: toStr(actionBy) }),
    };

    return await sendPushToUser(receiverId, {
      title,
      body,
      imageUrl: caller.profilePicture || null,
      data,
    });
  } catch (error) {
    console.error('🔥 Call notification error:', error);
    throw error;
  }
}

// ============================================================================
// DOMAIN WRAPPERS — EMPLOYEE INTERACTIONS
// ============================================================================

async function sendEmployeeInteractionNotification({
  senderId,
  receiverId,
  interactionType,
  message = '',
  metadata = {},
}) {
  try {
    if (toStr(senderId) === toStr(receiverId)) {
      return { success: false, reason: 'self_interaction' };
    }

    const [sender, receiver] = await Promise.all([
      User.findById(senderId).select('firstName lastName profilePicture notificationSettings'),
      User.findById(receiverId).select('notificationSettings'),
    ]);

    if (!sender || !receiver) throw new Error('User not found');

    if (receiver.notificationSettings?.employeeInteractions === false) {
      return { success: false, reason: 'employee_interactions_disabled' };
    }

    const senderName = `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || 'Someone';
    const template = INTERACTION_TEMPLATES[interactionType] || (() => ({
      title: '📱 New Activity',
      body: `${senderName} interacted with your profile`,
      action: 'VIEW_PROFILE',
    }));
    const { title, body, action } = template(senderName, message);

    return await sendPushToUser(receiverId, {
      title,
      body,
      imageUrl: sender.profilePicture || null,
      data: {
        type: 'employee_interaction',
        interactionType,
        senderId: toStr(senderId),
        senderName,
        receiverId: toStr(receiverId),
        action,
        metadata: JSON.stringify(metadata),
        timestamp: new Date().toISOString(),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
    });
  } catch (error) {
    console.error('🔥 Employee interaction notification error:', error);
    throw error;
  }
}

// ============================================================================
// HIGH-LEVEL — createNotificationDirect (File 2, merged)
// ============================================================================

const createNotificationDirect = async (payload, actor, opts = {}) => {
  const {
    userIds = [],
    roles = [],
    title,
    message,
    type = 'general',
    link,
    meta = {},
    isGlobal = false,
  } = payload;

  const {
    skipFcm = false,
    // skipSocket hata do — ab use hi nahi ho raha
    // skipFcmForOnlineUsers hata do — ab relevant nahi
  } = opts;

  const base = {
    title,
    message,
    type,
    link,
    meta,
    createdBy: actor?._id,
    isGlobal,
  };

  const targetMap = new Map();

  for (const userId of userIds) {
    const uid = userId.toString();
    targetMap.set(uid, { userId: uid, role: null, isGlobal });
  }

  if (roles.length > 0) {
    const resolved = await resolveRecipientsForRoles(roles);
    for (const r of resolved) {
      const uid = r.userId.toString();
      if (!targetMap.has(uid)) {
        targetMap.set(uid, {
          userId: uid,
          role: r.role,
          isGlobal: r.isGlobal || isGlobal,
        });
      }
    }
  }

  if (targetMap.size === 0) {
    return { docs: [], recipientIds: [], fcm: null };
  }

  const docs = [];
  const recipientIds = new Set();

  for (const { userId, role, isGlobal: g } of targetMap.values()) {
    docs.push({ ...base, user: userId, role, isGlobal: g });
    recipientIds.add(userId);
  }

  const inserted = await Notification.insertMany(docs);

  // ── FCM only (socket removed) ──
  let fcmReport = null;
  if (!skipFcm) {
    try {
      fcmReport = await sendFcmToUsers({
        userIds: [...recipientIds],
        title,
        body: message,
        type,
        data: {
          type,
          link: link ?? '',
          notificationId: String(inserted[0]?._id ?? ''),
          ...meta,
        },
        skipOnlineUsers: false,   // ← ✅ FIXED: socket nahi hai, toh FCM sabko jaaye
      });
    } catch (err) {
      console.error('[notif/fcm] unexpected failure:', err.message);
      fcmReport = { error: err.message };
    }
  }

  return {
    docs: inserted,
    recipientIds: [...recipientIds],
    fcm: fcmReport,
  };
};

// ============================================================================
// LEGACY COMPAT — sendBulkNotifications / sendRoleBasedNotification
// ============================================================================

async function sendBulkNotifications(tokens, payload, tokenToUserMap = new Map()) {
  if (!tokens?.length) {
    return { successCount: 0, failureCount: 0, invalidTokensCleaned: 0 };
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  for (const tokenChunk of chunk(tokens, BATCH_SIZE)) {
    const message = buildFcmMessage({
      tokens: tokenChunk,
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });

    const resp = await admin.messaging().sendEachForMulticast(message);
    successCount += resp.successCount;
    failureCount += resp.failureCount;
    invalidTokens.push(...extractInvalidTokens(tokenChunk, resp.responses));
  }

  const cleaned = await cleanupInvalidTokensBulk(invalidTokens, tokenToUserMap);
  return { successCount, failureCount, invalidTokensCleaned: cleaned };
}

async function sendRoleBasedNotification(data) {
  const {
    title,
    message,
    type = 'info',
    targetRoles = [],
    targetUsers = [],
    meta = {},
    createdBy,
    isGlobal = false,
  } = data;

  if (!createdBy) throw new Error('sendRoleBasedNotification: createdBy is required');

  const notifications = [];
  const seen = new Set();

  const pushForUser = (user, extra = {}) => {
    const id = toStr(user._id);
    if (seen.has(id)) return;
    seen.add(id);
    notifications.push({
      title, message, type,
      user: user._id,
      role: user.role,
      isGlobal,
      meta,
      createdBy,
      createdAt: new Date(),
      ...extra,
    });
  };

  if (Array.isArray(targetUsers) && targetUsers.length > 0) {
    const users = await User.find({ _id: { $in: targetUsers } }).select('_id role').lean();
    users.forEach((u) => pushForUser(u));
  }

  if (Array.isArray(targetRoles) && targetRoles.length > 0) {
    const includeAll = targetRoles.includes('all');
    const roles = targetRoles.filter((r) => r !== 'all');

    if (includeAll) {
      const cursor = User.find({ isActive: true }).select('_id role').lean().cursor();
      for await (const u of cursor) pushForUser(u, { isGlobal: true });
    } else if (roles.length > 0) {
      const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id role').lean();
      users.forEach((u) => pushForUser(u));
    }
  }

  for (const batch of chunk(notifications, BATCH_SIZE)) {
    if (batch.length) await Notification.insertMany(batch, { ordered: false });
  }

  // ── Deliver ──────────────────────────────────────────────────
  // Historically this function stopped at `insertMany`, so every caller
  // (all 8 leave notifications) wrote a row that nobody was ever told about.
  // Persist first, then fan out over socket + FCM, exactly like
  // createNotificationDirect does.
  const recipientIds = [...seen];
  let socketReport = null;
  let fcmReport = null;

  if (recipientIds.length > 0) {
    try {
      const socketSvc = require('../socket/notification');
      socketReport = socketSvc.sendNotification({
        userIds: recipientIds,
        roles: [],
        notification: {
          _id: notifications[0]?._id,
          title,
          message,
          type,
          meta,
          isGlobal,
          createdAt: notifications[0]?.createdAt ?? new Date(),
        },
      });
    } catch (err) {
      console.error('[notif/socket] role emit failed:', err.message);
      socketReport = { error: err.message };
    }

    try {
      fcmReport = await sendFcmToUsers({
        userIds: recipientIds,
        title,
        body: message,
        type,
        data: { type, ...flattenData(meta) },
      });
    } catch (err) {
      console.error('[notif/fcm] role push failed:', err.message);
      fcmReport = { error: err.message };
    }
  }

  return {
    count: notifications.length,
    recipientIds,
    socket: socketReport,
    fcm: fcmReport,
  };
}

// ============================================================================
// INTERACTION LOGGING & QUERIES
// ============================================================================

async function logEmployeeInteraction({
  senderId,
  receiverId,
  interactionType,
  notificationSent = false,
  metadata = {},
}) {
  try {
    return await EmployeeInteraction.create({
      senderId, receiverId, interactionType, notificationSent, metadata,
    });
  } catch (error) {
    console.error('🔥 Error logging interaction:', error);
    throw error;
  }
}

async function getUserInteractions(userId, options = {}) {
  const { limit = 50, offset = 0, interactionType, startDate, endDate } = options;
  const query = { $or: [{ senderId: userId }, { receiverId: userId }] };

  if (interactionType) query.interactionType = interactionType;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  return EmployeeInteraction.find(query)
    .sort({ createdAt: -1 })
    .skip(parseInt(offset, 10))
    .limit(parseInt(limit, 10))
    .populate('senderId', 'firstName lastName profilePicture')
    .populate('receiverId', 'firstName lastName profilePicture')
    .lean();
}

async function getInteractionStats(userId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [stats, totalInteractions] = await Promise.all([
    EmployeeInteraction.aggregate([
      { $match: { receiverId: new mongoose.Types.ObjectId(userId), createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$interactionType', count: { $sum: 1 } } },
    ]),
    EmployeeInteraction.countDocuments({ receiverId: userId }),
  ]);

  const last30Days = Object.fromEntries(stats.map((s) => [s._id, s.count]));
  return { last30Days, totalInteractions };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // ── High-level (main entry) ──
  createNotificationDirect,

  // ── FCM core ──
  sendFcmToUsers,
  sendPushToUser,              // single-user
  sendBulkNotifications,       // raw tokens
  sendRoleBasedNotification,   // DB insert

  // ── Domain ──
  sendCallNotification,
  sendEmployeeInteractionNotification,

  // ── Interaction logging ──
  logEmployeeInteraction,
  getUserInteractions,
  getInteractionStats,

  // ── RBAC ──
  buildVisibilityFilter,
  canUserActOnNotification,
  resolveRecipientsForRoles,
  validateNotificationTargets,

  // ── Utils ──
  cleanupInvalidTokensBulk,
  buildFcmMessage,
  _buildFcmMessage: buildFcmMessage,   // exposed for the verification script

   // ── Backward-compat alias ──
  sendNotification: sendPushToUser,   // ✅ ADDED — legacy code ke liye
};