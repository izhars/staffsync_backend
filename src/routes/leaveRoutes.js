// routes/leaveRoutes.js
const express = require('express');
const router = express.Router();
const { protect, managerAndAbove } = require('../middleware/auth');

const {
  applyLeave,
  getMyLeaves,
  getLeave,
  getLeaveBalance,
  cancelLeave,
  getPendingLeaves,
  approveLeave,
  rejectLeave,
  getAllLeaves
} = require('../controllers/leaveController');

// ================================
// 🔒 All routes below are protected
// ================================
router.use(protect);

// -------------------
// Employee Routes
// -------------------
router.route('/')
  .get(getMyLeaves)        // GET  /api/leaves → my leaves
  .post(applyLeave);       // POST /api/leaves → apply leave

router.get('/balance', getLeaveBalance);     // GET  /api/leaves/balance
router.put('/:id/cancel', cancelLeave);     // PUT  /api/leaves/:id/cancel

// -------------------
// Manager / HR / Superadmin Routes
// -------------------
router.get('/all', managerAndAbove, getAllLeaves);           // GET  /api/leaves/all
router.get('/pending/all', managerAndAbove, getPendingLeaves); // GET  /api/leaves/pending/all

router.put('/:id/approve', managerAndAbove, approveLeave);   // PUT  /api/leaves/:id/approve
router.put('/:id/reject', managerAndAbove, rejectLeave);     // PUT  /api/leaves/:id/reject

// -------------------
// Single Leave (any logged-in user can view if they own it or are manager/HR)
// -------------------
router.get('/:id', getLeave);  // Must be last

module.exports = router;