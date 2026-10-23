// socket/notifications.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let nsInstance = null;

/**
 * Initialize the /notifications namespace.
 * Each authenticated socket joins:
 *   - user:<id>   → personal room (personal notifications + count updates)
 *   - role:<role> → role-scoped broadcasts
 *   - all         → global broadcasts
 */
function initNotificationSocket(io) {
  if (nsInstance) {
    console.log('🔔 Notification namespace already initialized');
    return nsInstance;
  }

  nsInstance = io.of('/notifications');
  console.log('🔔 Initializing notification namespace...');

  // JWT auth middleware for this namespace only
  nsInstance.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        console.warn('[notif-socket] no token provided');
        return next(new Error('No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('_id role');
      if (!user) {
        console.warn('[notif-socket] user not found for id', decoded.id);
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (err) {
      console.error('[notif-socket] auth error:', err.message);
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  nsInstance.on('connection', (socket) => {
    const uid = socket.user._id.toString();
    const role = socket.user.role;

    // Join rooms matching server-side emit targets
    socket.join(`user:${uid}`);
    socket.join(`role:${role}`);
    socket.join('all');

    console.log(`🔔 [notif-socket] connected user=${uid} role=${role} sid=${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`🔕 [notif-socket] disconnected user=${uid}`);
    });
  });

  return nsInstance;
}

/**
 * Build a `sendNotification` bound to a specific namespace instance.
 *
 * Exported mainly so the delivery logic can be tested against a stub
 * namespace (no DB, no port). Production code uses `sendNotification`
 * below, which delegates to the live `/notifications` namespace.
 */
function createNotificationSender(ns) {
  return function send({ userIds = [], roles = [], notification }) {
    const report = {
      delivered: false,
      userCount: userIds.length,
      roleCount: roles.length,
      broadcast: userIds.length === 0 && roles.length === 0,
      listenerTotal: 0,
      rooms: [],
    };

    if (!ns) {
      report.reason = 'notification namespace not initialized';
      return report;
    }

    try {
      if (report.broadcast) {
        report.rooms.push('all');
      } else {
        for (const id of userIds) report.rooms.push(`user:${id.toString()}`);
        for (const role of roles) report.rooms.push(`role:${role}`);
      }

      for (const room of report.rooms) {
        report.listenerTotal += ns.adapter.rooms.get(room)?.size ?? 0;
      }

      // socket.io de-duplicates recipients across multiple `to()` calls.
      const emitter = report.rooms.reduce((acc, room) => acc.to(room), ns);
      emitter.emit('notification:new', notification);
      report.delivered = true;
    } catch (err) {
      report.reason = err.message;
      console.error('[notif] emit error:', err.message);
    }

    return report;
  };
}

/**
 * Programmatic emit helper (used by services/cron jobs that don't have req.io).
 *
 * Rooms are joined in the connection handler above:
 *   user:<id>   → personal notifications
 *   role:<role> → role-scoped broadcasts
 *   all         → global broadcasts
 *
 * @returns {{delivered:boolean, reason?:string, userCount:number, roleCount:number, broadcast:boolean, listenerTotal:number, rooms:string[]}}
 */
function sendNotification({ userIds = [], roles = [], notification }) {
  if (!nsInstance) {
    console.warn('[notif] nsInstance is NULL — socket not initialized');
  }
  return createNotificationSender(nsInstance)({ userIds, roles, notification });
}

/** True when at least one client is connected to the /notifications namespace. */
function isNotificationNamespaceReady() {
  return !!nsInstance;
}

/** Number of sockets currently connected to /notifications. */
function getNotificationSocketCount() {
  return nsInstance ? nsInstance.sockets.size : 0;
}

function getNotificationNamespace() {
  return nsInstance;
}

module.exports = {
  initNotificationSocket,
  sendNotification,
  createNotificationSender,
  getNotificationNamespace,
  isNotificationNamespaceReady,
  getNotificationSocketCount,
};