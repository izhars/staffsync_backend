// routes/celebrationRoutes.js
const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');

const {
  getTodaysBirthdays,
  getTodaysMarriageAnniversaries,
  getTodaysWorkAnniversaries,
  getAllUpComingCelebrations,
  getAllTodayCelebrations,
  getCelebrationStats,
  sendCelebrationNotification,
  getEmployeeDetails,
  // ─── NEW
  sendRegards,
  getMyReceivedRegards,
  getMySentRegards,
  markRegardRead,
} = require('../controllers/celebrationController');

router.use(protect);

// ─────────────────────────────────────────────
// Static routes
// ─────────────────────────────────────────────
router.get('/birthdays', getTodaysBirthdays);
router.get('/marriage-anniversaries', getTodaysMarriageAnniversaries);
router.get('/work-anniversaries', getTodaysWorkAnniversaries);
router.get('/all-upcoming', getAllUpComingCelebrations);
router.get('/all-today', getAllTodayCelebrations);
router.get('/stats', getCelebrationStats);

// ─────────────────────────────────────────────
// Peer regards — static paths MUST be before /:employeeId/...
// ─────────────────────────────────────────────
router.get('/regards/received', getMyReceivedRegards);
router.get('/regards/sent', getMySentRegards);
router.patch('/regards/:id/read', markRegardRead);

// ─────────────────────────────────────────────
// Admin-only action
// ─────────────────────────────────────────────
router.post('/send-notification', sendCelebrationNotification);

// ─────────────────────────────────────────────
// Peer regards — parameterized send
// ─────────────────────────────────────────────
router.post('/:employeeId/regards', sendRegards);

// ─────────────────────────────────────────────
// Parameterized routes — last
// ─────────────────────────────────────────────
router.get('/employee/:employeeId', getEmployeeDetails);

module.exports = router;