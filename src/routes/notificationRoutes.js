// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();

const {
  createNotification,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteMultiple,
  getNotificationCounts,
  clearAllNotifications,
  sendCallNotification,
} = require('../controllers/notificationController');

const { protect, hrAndAbove } = require('../middleware/auth');

// All notification routes require authentication
router.use(protect);

// ── Collection-level routes (specific paths first) ─────────────
router.post('/', hrAndAbove, createNotification);
router.post('/call/:callId', sendCallNotification); // ✅ fixed: callId param required by controller

router.get('/me', getMyNotifications);
router.get('/counts', getNotificationCounts);

router.patch('/read-all', markAllAsRead);

router.delete('/clear-all', clearAllNotifications);
router.delete('/', deleteMultiple);

// ── Item-level routes (with :id) come LAST ─────────────────────
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;