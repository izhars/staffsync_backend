const Task = require('../models/DailyTask');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

// @desc    Create or update daily task entry
// @route   POST /api/tasks
// @access  Private
exports.createOrUpdateDailyTask = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tasks, notes } = req.body;
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate total time
    const totalTime = tasks.reduce((total, task) => total + task.timeSpent, 0);

    // Create or update task entry for today
    let taskEntry = await Task.findOne({
      user: userId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (taskEntry) {
      // Update existing entry
      taskEntry.tasks = tasks;
      taskEntry.notes = notes;
      taskEntry.status = 'submitted';
      await taskEntry.save();
    } else {
      // Create new entry
      taskEntry = await Task.create({
        user: userId,
        date: new Date(),
        tasks,
        notes,
        status: 'submitted'
      });
    }

    res.status(200).json({
      success: true,
      data: taskEntry,
      message: 'Daily tasks submitted successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get today's task entry
// @route   GET /api/tasks/today
// @access  Private
exports.getTodayTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const taskEntry = await Task.findOne({
      user: userId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (!taskEntry) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No entry found for today'
      });
    }

    res.status(200).json({
      success: true,
      data: taskEntry
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get tasks by date range
// @route   GET /api/tasks
// @access  Private
exports.getTasksByDateRange = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    let query = { user: userId };

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      // Set end date to end of the day
      end.setUTCHours(23, 59, 59, 999);

      query.date = {
        $gte: start,
        $lte: end
      };
    }

    const tasks = await Task.find(query)
      .sort({ date: -1 })
      .populate('user', 'name email');

    res.status(200).json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Save as draft
// @route   POST /api/tasks/draft
// @access  Private
exports.saveAsDraft = async (req, res) => {
  try {
    const { tasks, notes } = req.body;
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let taskEntry = await Task.findOne({
      user: userId,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (taskEntry) {
      taskEntry.tasks = tasks;
      taskEntry.notes = notes;
      taskEntry.status = 'draft';
      await taskEntry.save();
    } else {
      taskEntry = await Task.create({
        user: userId,
        date: new Date(),
        tasks,
        notes,
        status: 'draft'
      });
    }

    res.status(200).json({
      success: true,
      data: taskEntry,
      message: 'Draft saved successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get weekly summary
// @route   GET /api/tasks/summary/weekly
// @access  Private
exports.getWeeklySummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const tasks = await Task.aggregate([
      {
        $match: {
          user: userId,                           // ← string is usually fine now
          // or: user: new mongoose.Types.ObjectId(userId),
          date: { $gte: startOfWeek },
          status: 'submitted'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          totalTime: { $sum: "$totalTime" },
          taskCount: { $sum: { $size: "$tasks" } }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    const totalWeeklyTime = tasks.reduce((sum, day) => sum + day.totalTime, 0);

    res.status(200).json({
      success: true,
      data: {
        days: tasks,
        totalWeeklyTime,
        averageDailyTime: totalWeeklyTime / (tasks.length || 1)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};