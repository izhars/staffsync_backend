// src/routes/roleRoutes.js
const express = require('express');
const router = express.Router();

const {
  createRole,
  getAllRoles,
  updateRole,
  deleteRole,
  updateResponsibilityProgress
} = require('../controllers/roleController');

const { protect, managerAndAbove } = require('../middleware/auth');

// ─────────────────────────────────────
// Role management routes
// Base: /api/v1/project-roles
// ─────────────────────────────────────
router
  .route('/')
  .get(protect, getAllRoles)
  .post(protect, managerAndAbove, createRole);

router
  .route('/:id')
  .patch(protect, managerAndAbove, updateRole)
  .delete(protect, managerAndAbove, deleteRole);

// ─────────────────────────────────────
// Responsibility progress
// Base: /api/v1/project-roles
// ─────────────────────────────────────
router.patch(
  '/responsibilities/:id/progress',
  protect,
  updateResponsibilityProgress
);

module.exports = router;
