const express = require("express");
const router = express.Router();

const {
  applyComboOff,
  reviewComboOff,
  getAllComboOffs,
  getMyComboOffs,
  getComboOffById,
  deleteComboOff,
  getMonthlyComboOffSummary,
  getComboOffBalance,
} = require("../controllers/comboOffController");

const { protect, hrAndAbove } = require("../middleware/auth");

/**
 * =========================
 * EMPLOYEE ROUTES
 * =========================
 */

// Apply for combo off
router.post("/", protect, applyComboOff);

// Get my combo offs
router.get("/me", protect, getMyComboOffs);

// Get combo off balance
router.get("/balance", protect, getComboOffBalance);

/**
 * =========================
 * HR / ADMIN ROUTES
 * =========================
 */

// Monthly summary
router.get(
  "/summary/monthly",
  protect,
  hrAndAbove,
  getMonthlyComboOffSummary
);

// Get all combo offs (optional ?status=pending|approved|rejected)
router.get("/", protect, hrAndAbove, getAllComboOffs);

// Review combo off (approve / reject)
router.put(
  "/:comboOffId/review",
  protect,
  hrAndAbove,
  reviewComboOff
);

/**
 * =========================
 * SHARED (KEEP LAST 🚨)
 * =========================
 */

// Get single combo off by ID
router.get("/:id", protect, getComboOffById);

// Delete combo off (employee, pending only)
router.delete("/:id", protect, deleteComboOff);

module.exports = router;
