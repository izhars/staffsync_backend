// routes/testNotifications.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { createNotificationDirect } = require('../firebase/notificationService');

router.post('/test', async (req, res) => {
  const t0 = Date.now();
  console.log('\n[notif-test] ▶ POST /test');

  try {
    const {
      userIds: rawUserIds = [],
      roles: rawRoles = [],
      title,
      message,
      type = 'general',
      link,
      meta = {},
      skipFcm = false,
      // skipSocket hata do — service use nahi karti
    } = req.body || {};

    if (!title || !message) {
      return res.status(400).json({ ok: false, error: 'title and message are required' });
    }

    const userIds = Array.isArray(rawUserIds) ? rawUserIds : (rawUserIds ? [rawUserIds] : []);
    const roles   = Array.isArray(rawRoles)   ? rawRoles   : (rawRoles   ? [rawRoles]   : []);

    const badIds = userIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (badIds.length) {
      return res.status(400).json({ ok: false, error: 'Invalid userId(s)', invalid: badIds });
    }

    const result = await createNotificationDirect(
      { userIds, roles, title, message, type, link, meta },
      req.user,
      { skipFcm },   // ✅ bas yeh — socket nahi hai ab
    );

    const ms = Date.now() - t0;
    console.log(`[notif-test] ◀ 200 OK (${ms}ms)`);
    console.log('[notif-test] recipients:', result.recipientIds.length);
    console.log('[notif-test] fcm       :', JSON.stringify(result.fcm, null, 2));

    res.json({
      ok: true,
      created: result.docs.length,
      targetedUserIds: userIds,
      targetedRoles: roles,
      totalRecipients: result.recipientIds.length,
      fcm: result.fcm,
      // socket: result.socket,   ← ❌ hata do, ab exist nahi karta
    });
  } catch (err) {
    console.error('[notif-test] 💥', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/check-fcm/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const User = require('../models/User');

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ ok: false, error: 'Invalid userId' });
    }

    const user = await User.findById(userId)
      .select('_id firstName lastName email role fcmToken isActive socketIds')
      .lean();

    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

    // ✅ Handle both string and array fcmToken
    const tokens = Array.isArray(user.fcmToken)
      ? user.fcmToken.filter(Boolean)
      : (user.fcmToken ? [user.fcmToken] : []);
    const hasFcm = tokens.length > 0;

    const isOnline = Array.isArray(user.socketIds) && user.socketIds.length > 0;

    res.json({
      ok: true,
      userId: user._id,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      role: user.role,
      isActive: user.isActive,
      hasFcm,
      tokenCount: tokens.length,
      isOnline,
      socketCount: user.socketIds?.length || 0,
      tokenPreviews: tokens.map((t) => t.slice(0, 20) + '...'),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;