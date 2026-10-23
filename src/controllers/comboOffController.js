// controllers/comboOffController.js
const moment = require("moment-timezone");
const ComboOff = require("../models/ComboOff");
const User = require("../models/User");
const Holiday = require("../models/Holiday");
const Leave = require("../models/Leave"); // moved to top-level

const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");

// ─────────────────────────────────────────────────────────────
// Helper: Check if date is valid for Combo Off (weekend or holiday)
// ─────────────────────────────────────────────────────────────
const isValidComboOffDate = async (date, user) => {
  const mDate = moment.tz(date, "Asia/Kolkata").startOf("day");
  const day = mDate.day(); // 0 = Sunday, 6 = Saturday

  const weekendType = user.weekendType || "sunday";

  const isWeekend =
    (weekendType === "sunday" && day === 0) ||
    (weekendType === "saturday_sunday" && (day === 0 || day === 6));

  const holiday = await Holiday.findOne({
    date: { $gte: mDate.toDate(), $lte: mDate.endOf("day").toDate() },
    isActive: true,
  });

  return isWeekend || !!holiday;
};

// ─────────────────────────────────────────────────────────────
// Step 1 — Employee applies for Combo Off
// ─────────────────────────────────────────────────────────────
exports.applyComboOff = asyncHandler(async (req, res) => {
  const employeeId = req.user.id;
  const { workDate, reason } = req.body;

  if (!workDate || !reason) {
    throw new AppError("Work date and reason are required", 400, {
      code: "MISSING_FIELDS",
    });
  }

  const date = moment.tz(workDate, "Asia/Kolkata").startOf("day").toDate();

  // ── Fetch user with probation fields ──
  const user = await User.findById(employeeId).select(
    "weekendType probationEndDate isProbationCompleted isActive status"
  );
  if (!user) {
    throw new AppError("User not found", 404, { code: "USER_NOT_FOUND" });
  }

  // ── Block combo off during probation ──
  const today = new Date();
  const onProbation =
    !user.isProbationCompleted &&
    user.probationEndDate &&
    today < new Date(user.probationEndDate);

  if (onProbation) {
    throw new AppError(
      "You are on probation. Combo Off is not allowed until your 6-month probation completes.",
      400,
      { code: "ON_PROBATION" }
    );
  }

  // ── Validate date is weekend/holiday ──
  const isValid = await isValidComboOffDate(date, user);
  if (!isValid) {
    throw new AppError(
      "Combo Off can only be applied for weekends or holidays.",
      400,
      { code: "INVALID_COMBO_OFF_DATE" }
    );
  }

  // ── Prevent duplicates ──
  const existing = await ComboOff.findOne({
    employee: employeeId,
    workDate: date,
  });

  if (existing) {
    throw new AppError("You have already applied for this date.", 400, {
      code: "DUPLICATE_COMBO_OFF",
    });
  }

  const comboOff = await ComboOff.create({
    employee: employeeId,
    workDate: date,
    reason,
    status: "pending",
  });

  res.status(201).json({
    success: true,
    message: "Combo Off application submitted successfully.",
    comboOff,
  });
});

// ─────────────────────────────────────────────────────────────
// Step 2 — HR approves or rejects Combo Off
// ─────────────────────────────────────────────────────────────
exports.reviewComboOff = asyncHandler(async (req, res) => {
  const { comboOffId } = req.params;
  const { action } = req.body; // 'approve' or 'reject'

  const comboOff = await ComboOff.findById(comboOffId);
  if (!comboOff) {
    throw new AppError("Combo Off not found", 404, {
      code: "COMBO_OFF_NOT_FOUND",
    });
  }

  if (comboOff.status !== "pending") {
    throw new AppError("This request has already been processed", 400, {
      code: "ALREADY_PROCESSED",
    });
  }

  if (!["approve", "reject"].includes(action)) {
    throw new AppError("Invalid action", 400, {
      code: "INVALID_ACTION",
    });
  }

  if (action === "approve") {
    comboOff.status = "approved";
    comboOff.approvedBy = req.user.id;
    comboOff.isCredited = true;

    // Credit combo balance
    await User.findByIdAndUpdate(comboOff.employee, {
      $inc: { "leaveBalance.combo": 1 },
    });
  } else {
    comboOff.status = "rejected";
    comboOff.approvedBy = req.user.id;
  }

  await comboOff.save();

  res.status(200).json({
    success: true,
    message: `Combo Off ${comboOff.status} successfully`,
    comboOff,
  });
});

// ─────────────────────────────────────────────────────────────
// Step 3 — Get all combo offs (HR/Admin)
// ─────────────────────────────────────────────────────────────
exports.getAllComboOffs = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = status ? { status } : {};

  const comboOffs = await ComboOff.find(query)
    .populate("employee", "firstName lastName email employeeId")
    .populate("approvedBy", "firstName lastName email")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: comboOffs.length,
    comboOffs,
  });
});

// ─────────────────────────────────────────────────────────────
// Step 4 — Get my combo offs (Employee)
// ─────────────────────────────────────────────────────────────
exports.getMyComboOffs = asyncHandler(async (req, res) => {
  const comboOffs = await ComboOff.find({ employee: req.user.id }).sort({
    createdAt: -1,
  });

  res.status(200).json({
    success: true,
    comboOffs,
  });
});

// ─────────────────────────────────────────────────────────────
// Step 5 — Get single combo off by ID
// ─────────────────────────────────────────────────────────────
exports.getComboOffById = asyncHandler(async (req, res) => {
  const comboOff = await ComboOff.findById(req.params.id)
    .populate("employee", "firstName lastName email")
    .populate("approvedBy", "firstName lastName email");

  if (!comboOff) {
    throw new AppError("Combo Off not found", 404, {
      code: "COMBO_OFF_NOT_FOUND",
    });
  }

  res.status(200).json({ success: true, comboOff });
});

// ─────────────────────────────────────────────────────────────
// Step 6 — Delete combo off (Employee only, pending status)
// ─────────────────────────────────────────────────────────────
exports.deleteComboOff = asyncHandler(async (req, res) => {
  const comboOff = await ComboOff.findById(req.params.id);

  if (!comboOff) {
    throw new AppError("Combo Off not found", 404, {
      code: "COMBO_OFF_NOT_FOUND",
    });
  }

  if (comboOff.employee.toString() !== req.user.id) {
    throw new AppError("Not authorized to delete this request", 403, {
      code: "NOT_AUTHORIZED",
    });
  }

  if (comboOff.status !== "pending") {
    throw new AppError("Cannot delete processed requests", 400, {
      code: "CANNOT_DELETE_PROCESSED",
    });
  }

  await comboOff.deleteOne();

  res.status(200).json({
    success: true,
    message: "Combo Off request deleted successfully",
  });
});

// ─────────────────────────────────────────────────────────────
// Step 7 — Monthly Combo Off Summary (HR/Admin)
// ─────────────────────────────────────────────────────────────
exports.getMonthlyComboOffSummary = asyncHandler(async (req, res) => {
  const { month, year } = req.query;

  if (!month || !year) {
    throw new AppError("Month and year are required", 400, {
      code: "MISSING_FIELDS",
    });
  }

  const monthNumber = Number(month);
  const yearNumber = Number(year);

  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new AppError("Month must be between 1 and 12", 400, {
      code: "INVALID_MONTH",
    });
  }

  if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2100) {
    throw new AppError("Invalid year", 400, { code: "INVALID_YEAR" });
  }

  const formattedMonth = String(monthNumber).padStart(2, "0");
  const startDate = moment.tz(`${yearNumber}-${formattedMonth}-01`, "YYYY-MM-DD", true);

  if (!startDate.isValid()) {
    throw new AppError("Invalid month/year", 400, {
      code: "INVALID_DATE",
    });
  }

  const endDate = startDate.clone().endOf("month");

  const summary = await ComboOff.aggregate([
    {
      $match: {
        status: "approved",
        workDate: { $gte: startDate.toDate(), $lte: endDate.toDate() },
      },
    },
    { $group: { _id: "$employee", totalApproved: { $sum: 1 } } },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "employee",
      },
    },
    { $unwind: "$employee" },
    {
      $project: {
        _id: 0,
        employeeId: "$employee._id",
        name: { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
        email: "$employee.email",
        totalApproved: 1,
      },
    },
    { $sort: { name: 1 } },
  ]);

  res.status(200).json({
    success: true,
    month: monthNumber,
    year: yearNumber,
    totalEmployees: summary.length,
    summary,
  });
});

// ─────────────────────────────────────────────────────────────
// Step 8 — Get Combo Off balance (Employee)
// ─────────────────────────────────────────────────────────────
exports.getComboOffBalance = asyncHandler(async (req, res) => {
  const employeeId = req.user.id;

  const user = await User.findById(employeeId).select("leaveBalance");
  if (!user) {
    throw new AppError("User not found", 404, { code: "USER_NOT_FOUND" });
  }

  const currentYear = moment().year();
  const yearStart = moment(`${currentYear}-01-01`).toDate();
  const yearEnd = moment(`${currentYear}-12-31`).toDate();

  // Used = approved combo leaves (via Leave model)
  const usedThisYear = await Leave.countDocuments({
    employee: employeeId,
    leaveType: "combo",
    status: "approved",
    startDate: { $gte: yearStart, $lte: yearEnd },
  });

  const pendingCount = await ComboOff.countDocuments({
    employee: employeeId,
    status: "pending",
  });

  res.status(200).json({
    success: true,
    balance: {
      available: user.leaveBalance?.combo || 0,
      usedThisYear,
      pending: pendingCount,
    },
  });
});