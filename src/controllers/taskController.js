// controllers/taskController.js
const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const { ACCESS_ROLES } = require('../constants/roles');
const {
  notifyTaskAssigned,
  notifyTaskUpdated,
  notifyTaskCompleted,
  notifyTaskComment,
} = require('../utils/taskNotifications');

// ===========================================
// Helpers
// ===========================================

/**
 * Normalize a role value to the canonical ACCESS_ROLES form.
 * Mirrors the logic in middleware/auth.js so both layers agree.
 */
const normalizeRoleName = (role) => {
  const roleName = String(role || '').trim().toLowerCase();
  const legacyAliases = {
    admin: ACCESS_ROLES.HR_ADMIN,
    hr: ACCESS_ROLES.HR_ADMIN,
    superadmin: ACCESS_ROLES.SUPER_ADMIN,
    teamlead: ACCESS_ROLES.TEAM_LEAD,
    team_lead: ACCESS_ROLES.TEAM_LEAD,
  };
  return legacyAliases[roleName] || roleName;
};

/**
 * Safely extract an assignee id from a task whose `assignee` may be:
 *  - a raw ObjectId
 *  - a populated user document
 *  - a string
 * Returns null when it can't be resolved.
 */
const extractAssigneeId = (task) => {
  const a = task?.assignee;
  if (!a) return null;
  if (typeof a === 'string') return a;
  if (a._id) return a._id.toString();
  if (typeof a.toString === 'function') return a.toString();
  return null;
};

const isAdmin = (user) => {
  const role = normalizeRoleName(user?.role);
  return role === ACCESS_ROLES.SUPER_ADMIN || role === ACCESS_ROLES.HR_ADMIN;
};

const isManager = (user) => normalizeRoleName(user?.role) === ACCESS_ROLES.MANAGER;

/**
 * Check if the requester may manage tasks for the given assignee.
 * Rules:
 *  - superadmin / hr : always
 *  - manager         : only for their direct reports
 *  - self            : only for their own tasks
 */
const canManageEmployeeTasks = async (requester, assigneeId) => {
  if (!requester || !assigneeId) return false;

  const assignee = await User.findById(assigneeId).select('_id managerId');
  if (!assignee) return false;

  const requesterId = requester._id.toString();
  const assigneeIdStr = assignee._id.toString();
  const role = normalizeRoleName(requester.role);

  if (role === ACCESS_ROLES.SUPER_ADMIN || role === ACCESS_ROLES.HR_ADMIN) return true;
  if (role === ACCESS_ROLES.MANAGER && assignee.managerId?.toString() === requesterId) return true;
  if (requesterId === assigneeIdStr) return true;

  return false;
};

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit };
};

// ===========================================
// GET All Tasks
// ===========================================
exports.getTasks = async (req, res) => {
  try {
    const { status, category, assignee } = req.query;
    const { page, limit } = parsePagination(req.query);

    const query = {};

    // Role-based scoping
    if (!isAdmin(req.user)) {
      const managedEmployees = isManager(req.user)
        ? await User.find({ managerId: req.user._id }).select('_id').lean()
        : [];

      const allowedIds = [
        ...managedEmployees.map((u) => u._id.toString()),
        req.user._id.toString(),
      ];

      // If caller filters by a specific assignee, verify it's within scope
      if (assignee) {
        if (!allowedIds.includes(assignee.toString())) {
          return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        query.assignee = assignee;
      } else {
        query.assignee = { $in: allowedIds };
      }
    } else if (assignee) {
      query.assignee = assignee;
    }

    if (status) query.status = status;
    if (category) query.category = category;

    const [tasks, total] = await Promise.all([
      Task.find(query)
        .populate('assignee', 'firstName lastName email')
        .populate('assigner', 'firstName lastName')
        .sort({ dueDate: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Task.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: tasks,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('❌ getTasks error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===========================================
// GET Single Task
// ===========================================
exports.getTask = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const task = await Task.findById(req.params.id)
      .populate('assignee', 'firstName lastName email fullName daysToAnniversary id')
      .populate('assigner', 'firstName lastName email fullName daysToAnniversary id')
      .populate({ path: 'comments.author', select: 'firstName lastName email fullName' })
      .lean();

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Latest comments first
    if (task.comments?.length) {
      task.comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const assigneeId = extractAssigneeId(task);
    const allowed = await canManageEmployeeTasks(req.user, assigneeId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.json({ success: true, data: task });
  } catch (err) {
    console.error('❌ getTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===========================================
// Create Task
// ===========================================
exports.createTask = async (req, res) => {
  try {
    const { title, description, assigneeId, category, dueDate } = req.body;

    if (!title || !assigneeId) {
      return res.status(400).json({
        success: false,
        message: 'title and assigneeId are required',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assigneeId)) {
      return res.status(400).json({ success: false, message: 'Invalid assigneeId' });
    }

    const allowed = await canManageEmployeeTasks(req.user, assigneeId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const task = await Task.create({
      title,
      description,
      assignee: assigneeId,
      assigner: req.user._id,
      category,
      dueDate,
    });

    await task.populate({
      path: 'assignee',
      select: 'firstName lastName email employeeId profilePicture designation department',
    });
    await task.populate({
      path: 'assigner',
      select: 'firstName lastName email employeeId profilePicture designation',
    });

    await notifyTaskAssigned(task.assignee._id, task);

    res.status(201).json({ success: true, data: task });
  } catch (err) {
    console.error('❌ createTask error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

// ===========================================
// Update Task
// ===========================================
const EDITABLE_FIELDS = ['title', 'description', 'category', 'dueDate', 'status'];

exports.updateTask = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const allowed = await canManageEmployeeTasks(req.user, task.assignee);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Whitelist editable fields — never let the client overwrite assignee/assigner/_id
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        task[field] = req.body[field];
      }
    }

    // Reassignment is admin/HR only, and the new assignee must be manageable
    if (req.body.assigneeId !== undefined) {
      if (!isAdmin(req.user)) {
        return res.status(403).json({
          success: false,
          message: 'Only admins can reassign a task',
        });
      }
      if (!mongoose.Types.ObjectId.isValid(req.body.assigneeId)) {
        return res.status(400).json({ success: false, message: 'Invalid assigneeId' });
      }

      const newAssigneeAllowed = await canManageEmployeeTasks(req.user, req.body.assigneeId);
      if (!newAssigneeAllowed) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to reassign to this user',
        });
      }

      task.assignee = req.body.assigneeId;
    }

    // Keep completedAt consistent with status
    if (task.status === 'completed' && !task.completedAt) {
      task.completedAt = new Date();
    } else if (task.status !== 'completed') {
      task.completedAt = undefined;
    }

    await task.save();
    await task.populate('assignee assigner');

    await notifyTaskUpdated(task.assignee._id, task);

    res.json({ success: true, data: task });
  } catch (err) {
    console.error('❌ updateTask error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

// ===========================================
// Complete Task
// ===========================================
exports.completeTask = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const assigneeId = extractAssigneeId(task);
    const allowed = await canManageEmployeeTasks(req.user, assigneeId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Idempotent: if already completed, don't overwrite completedAt
    if (task.status === 'completed') {
      await task.populate('assignee assigner');
      return res.json({ success: true, data: task });
    }

    task.status = 'completed';
    task.completedAt = new Date();

    await task.save();
    await task.populate('assignee assigner');

    await notifyTaskCompleted(task.assignee._id, task);

    res.json({ success: true, data: task });
  } catch (err) {
    console.error('❌ completeTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===========================================
// Add Comment
// ===========================================
exports.addComment = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Comment text is required' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const assigneeId = extractAssigneeId(task);
    const allowed = await canManageEmployeeTasks(req.user, assigneeId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    task.comments.push({
      text: text.trim(),
      author: req.user._id,
    });

    await task.save();
    await task.populate('comments.author', 'firstName lastName email');

    // Standardized signature: (userId, task)
    await notifyTaskComment(req.user._id, task);

    res.json({ success: true, data: task });
  } catch (err) {
    console.error('🔥 addComment failed:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

// ===========================================
// Delete Task
// ===========================================
exports.deleteTask = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const admin = isAdmin(req.user);
    const isAssigner = task.assigner?.toString() === req.user._id.toString();

    if (!admin && !isAssigner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this task',
      });
    }

    await Task.findByIdAndDelete(task._id);

    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err) {
    console.error('❌ deleteTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};