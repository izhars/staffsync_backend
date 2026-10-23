// controllers/notificationController.js
const Notification = require('../models/Notification');
const User = require('../models/User');
const {
  buildVisibilityFilter,
  canUserActOnNotification,
  validateNotificationTargets,
  createNotificationDirect,
} = require('../firebase/notificationService');
const {
  ACCESS_ROLES,
  normalizeRoleName,
  isHrAdminOrAbove,
} = require('../constants/roles');

const NOTIF_NS = '/notifications';

/* ──────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────── */
const parsePagination = (query) => {
  const page  = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, skip: (page - 1) * limit };
};

const applyCommonFilters = (filter, query) => {
  const { read, type, from, to } = query;

  if (read !== undefined && read !== '') filter.read = read === 'true';
  if (type) filter.type = type;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to)   filter.createdAt.$lte = new Date(to);
  }

  return filter;
};

/**
 * Emit an event on the /notifications namespace.
 */
const emitToUser = (req, userId, event, payload) => {
  if (!req.io || !userId) return;
  const ns = req.io.of ? req.io.of(NOTIF_NS) : req.io;
  ns.to(`user:${userId.toString()}`).emit(event, payload);
};

const emitToRoom = (req, room, event, payload) => {
  if (!req.io) return;
  const ns = req.io.of ? req.io.of(NOTIF_NS) : req.io;
  ns.to(room).emit(event, payload);
};

/* ──────────────────────────────────────────────
   POST /api/notifications
   ────────────────────────────────────────────── */
exports.createNotification = async (req, res) => {
  try {
    const { userIds = [], roles = [], title, message, type, link, meta } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'title and message are required.',
      });
    }

    if (userIds.length === 0 && roles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one userId or role to target.',
      });
    }

    if (roles.length > 0) {
      const { allowed, unauthorized } = validateNotificationTargets(
        req.user.role,
        roles,
      );
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: `You don't have permission to notify roles: ${unauthorized.join(', ')}`,
        });
      }
    }

    // ✅ Service handles socket emit internally — don't double-emit
    const result = await createNotificationDirect(
      { userIds, roles, title, message, type, link, meta },
      req.user,
      { skipSocket: false, skipFcm: false, skipFcmForOnlineUsers: true },
    );

    // ⚠️ Only emit manually if you set skipSocket: true above
    // for (const n of result.docs) {
    //   if (n.user) emitToUser(req, n.user, 'notification:new', n);
    // }

    return res.status(201).json({
      success: true,
      count: result.docs.length,
      recipientIds: result.recipientIds,
      socket: result.socket,
      fcm: result.fcm,
      data: result.docs,
    });
  } catch (err) {
    console.error('createNotification error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   GET /api/notifications/me
   ────────────────────────────────────────────── */
exports.getMyNotifications = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { sort = 'desc' } = req.query;

    const baseFilter = buildVisibilityFilter(req.user);
    const filter = applyCommonFilters({ ...baseFilter }, req.query);
    const unreadFilter = { ...baseFilter, read: false };

    const [notifications, total, unread] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: sort === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments(unreadFilter),
    ]);

    return res.json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        unread,
      },
      data: notifications,
    });
  } catch (err) {
    console.error('getMyNotifications error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   PATCH /api/notifications/:id/read
   ────────────────────────────────────────────── */
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification || notification.deleted) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (!canUserActOnNotification(req.user, notification)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this notification',
      });
    }

    const wasUnread = !notification.read;
    notification.read = true;
    await notification.save();

    if (wasUnread) {
      emitToUser(req, notification.user, 'notification:read', {
        id: notification._id,
        userId: notification.user,
      });
    }

    return res.json({ success: true, data: notification });
  } catch (err) {
    console.error('markAsRead error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   PATCH /api/notifications/read-all
   ────────────────────────────────────────────── */
exports.markAllAsRead = async (req, res) => {
  try {
    const filter = buildVisibilityFilter(req.user);
    const result = await Notification.updateMany(
      { ...filter, read: false },
      { $set: { read: true } },
    );

    emitToUser(req, req.user._id, 'notification:read-all', {
      modifiedCount: result.modifiedCount,
    });

    return res.json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error('markAllAsRead error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   DELETE /api/notifications/:id
   ────────────────────────────────────────────── */
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification || notification.deleted) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (!canUserActOnNotification(req.user, notification)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this notification',
      });
    }

    const wasUnread = !notification.read;
    notification.deleted = true;
    notification.deletedAt = new Date();
    notification.deletedBy = req.user._id;
    await notification.save();

    emitToUser(req, notification.user, 'notification:deleted', {
      ids: [notification._id],
      wasUnread,
    });

    return res.json({
      success: true,
      message: 'Notification deleted',
      data: notification,
    });
  } catch (err) {
    console.error('deleteNotification error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   DELETE /api/notifications  (bulk)
   ────────────────────────────────────────────── */
exports.deleteMultiple = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No IDs provided' });
    }

    const notifications = await Notification.find({ _id: { $in: ids } });

    for (const n of notifications) {
      if (!canUserActOnNotification(req.user, n)) {
        return res.status(403).json({
          success: false,
          message: `Not authorized to delete notification ${n._id}`,
        });
      }
    }

    const unreadAmong = notifications.filter((n) => !n.read).length;

    const result = await Notification.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          deleted: true,
          deletedAt: new Date(),
          deletedBy: req.user._id,
        },
      },
    );

    emitToUser(req, req.user._id, 'notification:deleted', {
      ids,
      wasUnread: unreadAmong > 0,
      unreadCount: unreadAmong,
    });

    return res.json({
      success: true,
      message: 'Selected notifications deleted',
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error('deleteMultiple error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   GET /api/notifications/counts
   ────────────────────────────────────────────── */
exports.getNotificationCounts = async (req, res) => {
  try {
    const filter = buildVisibilityFilter(req.user);

    const [total, unread, read, typeCounts] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, read: false }),
      Notification.countDocuments({ ...filter, read: true }),
      Notification.aggregate([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
    ]);

    return res.json({
      success: true,
      counts: {
        total,
        unread,
        read,
        byType: typeCounts.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    console.error('getNotificationCounts error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   DELETE /api/notifications/clear-all
   ────────────────────────────────────────────── */
exports.clearAllNotifications = async (req, res) => {
  try {
    const filter = buildVisibilityFilter(req.user);

    const result = await Notification.updateMany(filter, {
      $set: {
        deleted: true,
        deletedAt: new Date(),
        deletedBy: req.user._id,
      },
    });

    emitToUser(req, req.user._id, 'notification:deleted', {
      ids: [],
      all: true,
    });

    return res.json({
      success: true,
      message: 'All notifications cleared',
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error('clearAllNotifications error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ──────────────────────────────────────────────
   POST /api/notifications/call/:callId
   ✅ Now uses createNotificationDirect properly
   ────────────────────────────────────────────── */
exports.sendCallNotification = async (req, res) => {
  try {
    const AgoraCall = require('../models/AgoraCall');
    const { callId } = req.params;
    const { title, message, type = 'info', targetUserIds } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'title and message are required',
      });
    }

    const call = await AgoraCall.findOne({ callId, deleted: false });
    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    const isParticipant = call.participants.some(
      (p) => p.user.toString() === req.user._id.toString(),
    );
    const isInitiator = call.initiator.toString() === req.user._id.toString();

    if (!isParticipant && !isInitiator) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to send notifications for this call',
      });
    }

    let recipients = [];
    if (Array.isArray(targetUserIds) && targetUserIds.length > 0) {
      recipients = targetUserIds;
    } else {
      recipients = call.participants
        .filter((p) => p.user.toString() !== req.user._id.toString())
        .map((p) => p.user);
    }

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients specified',
      });
    }

    // ✅ Build sender name from firstName/lastName
    const senderName =
      `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() ||
      req.user.email ||
      'User';

    const result = await createNotificationDirect(
      {
        userIds: recipients,
        title,
        message,
        type: 'call',
        link: `/call/${callId}`,
        meta: {
          callId,
          action: 'call_notification',
          sentBy: String(req.user._id),
          sentByName: senderName,
          uiType: type,
        },
      },
      req.user,
      { skipSocket: false, skipFcm: false, skipFcmForOnlineUsers: true },
    );

    // ⚠️ Service already emitted socket — no manual emit here
    return res.json({
      success: true,
      message: 'Notification sent',
      data: {
        recipients: recipients.length,
        created: result.docs.length,
        recipientIds: result.recipientIds,
        socket: result.socket,
        fcm: result.fcm,
      },
    });
  } catch (err) {
    console.error('sendCallNotification error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};