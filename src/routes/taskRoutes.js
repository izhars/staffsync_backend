// routes/taskRoutes.js
const express = require('express');
const router = express.Router();

const { protect, hrAdminAndAbove, managerAndAbove } = require('../middleware/auth');

const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
  addComment,
  deleteTask,
} = require('../controllers/taskController');

router.use(protect);

// ─────────────────────────────────────────────
// Collection routes
// ─────────────────────────────────────────────
router.get('/', getTasks);
router.post('/', managerAndAbove, createTask);

// ─────────────────────────────────────────────
// Sub-resource routes (must come before /:id handlers)
// ─────────────────────────────────────────────
router.post('/:id/complete', completeTask);
router.post('/:id/comments', addComment);

// ─────────────────────────────────────────────
// Single-resource routes
// ─────────────────────────────────────────────
router.get('/:id', getTask);
router.patch('/:id', managerAndAbove, updateTask);
router.delete('/:id', hrAdminAndAbove, deleteTask);

module.exports = router;