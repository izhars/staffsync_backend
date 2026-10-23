const express = require('express');
const router = express.Router();
const { sendNotification } = require('../firebase/notificationService');

// Root Route
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to HRMS API with Real-Time Chat & Email Service',
    version: '1.0.0',
    documentation: '/api/docs',
  });
});

// Health Check
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'HRMS API is running fine',
    timestamp: new Date().toISOString(),
  });
});

// 🔔 Test Notification Route
// Example: GET /send-test-notification?userId=123
router.get('/send-test-notification', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId query param is required' });
  }

  try {
    await sendNotification(userId, {
      notification: {
        title: 'Test Notification',
        body: 'This is a test message from HRMS API 🚀'
      },
      data: { test: 'true' }
    });

    res.status(200).json({ success: true, message: `Notification sent (if FCM token exists) to user ${userId}` });
  } catch (error) {
    console.error('❌ Test notification error:', error);
    res.status(500).json({ success: false, message: 'Failed to send notification' });
  }
});

module.exports = router;
