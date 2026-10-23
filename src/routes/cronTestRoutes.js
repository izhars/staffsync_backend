// routes/cronTestRoutes.js
const express = require('express');
const router = express.Router();
const cronTestController = require('../controllers/cronTestController');

// Manual test routes
router.post('/test/auto-checkout', cronTestController.testAutoCheckout);
router.post('/test/mark-absent', cronTestController.testMarkAbsent);
router.post('/test/birthday-wishes', cronTestController.testBirthdayWishes);

// Data view routes
router.get('/test/pending-checkouts', cronTestController.getPendingCheckouts);
router.get('/test/today-attendance', cronTestController.getTodayAttendance);

module.exports = router;
