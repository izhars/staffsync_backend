// controllers/cronTestController.js
const { cronTasks } = require('../utils/cronJobs');
const Attendance = require('../models/Attendance');
const moment = require('moment-timezone');

// 🧪 Manual test: Auto checkout
exports.testAutoCheckout = async (req, res) => {
  try {
    const result = await cronTasks.autoCheckoutEmployees();
    res.json({
      success: true,
      message: 'Auto checkout executed',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Auto checkout failed',
      error: error.message
    });
  }
};

// 🧪 Manual test: Mark absent
exports.testMarkAbsent = async (req, res) => {
  try {
    const result = await cronTasks.markAbsentEmployees();
    res.json({
      success: true,
      message: 'Mark absent executed',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Mark absent failed',
      error: error.message
    });
  }
};

// 🧪 Manual test: Birthday wishes
exports.testBirthdayWishes = async (req, res) => {
  try {
    const result = await cronTasks.sendBirthdayWishes();
    res.json({
      success: true,
      message: 'Birthday wishes executed',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Birthday wishes failed',
      error: error.message
    });
  }
};

// 🧪 View pending checkouts
exports.getPendingCheckouts = async (req, res) => {
  try {
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

    const pendingAttendances = await Attendance.find({
      date: today,
      'checkIn.time': { $exists: true },
      'checkOut.time': { $exists: false },
      status: 'present',
    }).populate('employee', 'name email');

    res.json({
      success: true,
      count: pendingAttendances.length,
      date: today,
      pendingAttendances: pendingAttendances.map(att => ({
        employee: att.employee?.name || att.employee,
        checkInTime: att.checkIn?.time,
        status: att.status
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// 🧪 View today’s attendance
exports.getTodayAttendance = async (req, res) => {
  try {
    const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

    const attendances = await Attendance.find({
      date: today
    }).populate('employee', 'name email');

    res.json({
      success: true,
      date: today,
      count: attendances.length,
      attendances: attendances.map(att => ({
        employee: att.employee?.name || att.employee,
        status: att.status,
        checkIn: att.checkIn?.time,
        checkOut: att.checkOut?.time,
        missedCheckout: att.missedCheckout || false
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
