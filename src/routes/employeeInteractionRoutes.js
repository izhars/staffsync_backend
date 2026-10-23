const express = require('express');
const router = express.Router();
const { 
  trackCallInteraction,
  getUserInteractionHistory,
  getInteractionStatistics,
  trackCallEnd
} = require('../controllers/employeeInteractionController');
const { protect } = require('../middleware/auth');

// Track interactions
router.post('/track-call', protect, trackCallInteraction);
router.post('/track-call-end', protect, trackCallEnd);

// Get interaction data
router.get('/history', protect, getUserInteractionHistory);
router.get('/statistics', protect, getInteractionStatistics);

module.exports = router;