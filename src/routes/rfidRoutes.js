const express = require('express');
const { 
  createRfidScan, 
  getRecentScans, 
  getScansGroupedByDate,
  getScansByLane,
  getLaneStatistics,
  getOnlyMedia,
  deleteRfidScan
} = require('../controllers/rfidController');
const { upload } = require('../middleware/upload');

const router = express.Router();

// RFID scan with optional images and lane data
router.post(
  '/',
  upload.array('image', 5), // images optional ✅
  createRfidScan
);

// Get recent scans (for debugging / admin)
router.get('/recent', getRecentScans);

// Get scans grouped by date (for history screen)
router.get('/grouped/date', getScansGroupedByDate);

// New: Get scans by specific lane
router.get('/lane/:lane_entry_id', getScansByLane);

// New: Get lane statistics
router.get('/lane-stats', getLaneStatistics);

router.get('/media-only', getOnlyMedia);

router.delete('/:id', deleteRfidScan);

module.exports = router;