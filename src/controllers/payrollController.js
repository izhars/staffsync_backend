// controllers/payrollController.js
const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { buildMonthMap, summarize } = require('../services/attendanceResolver');
const {
  notifyPayslipGenerated,
  notifySalaryPaid,
  notifyPayrollCorrected,
} = require('../utils/payrollNotifications');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** EPF statutory wage ceiling (India) */
const EPF_WAGE_CEILING = 15000;
const EPF_RATE_DEFAULT = 0.12;
const BENEVOLENT_FUND_RATE_DEFAULT = 0.01;

// ─────────────────────────────────────────────
// @desc    Generate Payroll (with accurate proration)
// @route   POST /api/payroll/generate
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.generatePayroll = async (req, res) => {
  const TAG = '[generatePayroll]';
  try {
    const {
      employeeId, month, year,
      bonus = 0,
      overtime = 0,
      otherEarnings = 0,
      insurance = 0,
      advance = 0,
      otherDeductions = 0,
      pfRate = null,
      taxRate = 0.10,
      pt = 200,
      publicHolidays = [],
      paidWeekends = true,
      paidHolidays = true,
      paidLeaves = true,
      latePenalty = 'none',
      shortPenalty = 'none',
      graceMinutes = 15,
      halfDayLateMin = 120,
      lateDeductionPerMinute = 0,
    } = req.body;

    // ── 1. Validation ────────────────────────────────────────────
    if (!employeeId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'employeeId, month, and year are required',
      });
    }
    const m = Number(month);
    const y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ success: false, message: 'Invalid month' });
    }
    if (!Number.isInteger(y) || y < 2000) {
      return res.status(400).json({ success: false, message: 'Invalid year' });
    }

    const now = new Date();
    if (y > now.getFullYear() ||
      (y === now.getFullYear() && m >= now.getMonth() + 1)) {
      return res.status(400).json({
        success: false,
        message: `Cannot generate payroll for ${m}/${y}. Wait until the month ends.`,
      });
    }

    // ── 2. Duplicate check ───────────────────────────────────────
    const existing = await Payroll.findOne({
      employee: employeeId,
      month: m,
      year: y,
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Payroll already exists for this period',
      });
    }

    // ── 3. Load employee + validate salary ───────────────────────
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${TAG} START`, { employeeId, month: m, year: y });
    console.log(`${'═'.repeat(60)}`);

    // ── LOG BLOCK 1: employee snapshot ───────────────────────────
    console.log(`\n${TAG} ─── 1. EMPLOYEE SNAPSHOT ───`);
    console.log(`  name:            ${employee.firstName} ${employee.lastName} (${employee.employeeId})`);
    console.log(`  role:            ${employee.role}`);
    console.log(`  weekendType:     ${employee.weekendType}`);
    console.log(`  dateOfJoining:   ${employee.dateOfJoining}  (raw: ${JSON.stringify(employee.dateOfJoining)})`);
    console.log(`  dateOfLeaving:   ${employee.dateOfLeaving}  (raw: ${JSON.stringify(employee.dateOfLeaving)})`);
    console.log(`  isActive:        ${employee.isActive}`);
    console.log(`  salary:`, JSON.stringify(employee.salary, null, 2));

    const salary = employee.salary || {};
    if (!salary.basic || salary.basic <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee has no basic salary set',
      });
    }

    // ── 4. Employment window check ───────────────────────────────
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));

    const doj = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null;
    const dol = employee.dateOfLeaving ? new Date(employee.dateOfLeaving) : null;

    // ── LOG BLOCK 2: resolved employment window ─────────────────
    console.log(`\n${TAG} ─── 2. EMPLOYMENT WINDOW ───`);
    console.log(`  monthStart:      ${monthStart.toISOString()}`);
    console.log(`  monthEnd:        ${monthEnd.toISOString()}`);
    console.log(`  doj (parsed):    ${doj ? doj.toISOString() : 'null'}`);
    console.log(`  dol (parsed):    ${dol ? dol.toISOString() : 'null'}`);
    console.log(`  doj > monthEnd?  ${doj && doj > monthEnd}`);
    console.log(`  dol < monthStart? ${dol && dol < monthStart}`);

    if (doj && doj > monthEnd) {
      return res.status(400).json({
        success: false,
        message: `Employee joined on ${doj.toISOString().slice(0, 10)}, after ${m}/${y}.`,
      });
    }
    if (dol && dol < monthStart) {
      return res.status(400).json({
        success: false,
        message: `Employee left on ${dol.toISOString().slice(0, 10)}, before ${m}/${y}.`,
      });
    }

    // ── 5. Resolve per-day attendance map ────────────────────────
    console.log(`\n${TAG} ─── 3. CALLING buildMonthMap ───`);
    console.log(`  args:`, {
      employeeId,
      year: y,
      month: m,
      publicHolidays,
      dateOfJoining: doj,
      dateOfLeaving: dol,
    });

    const dayMap = await buildMonthMap({
      employeeId,
      year: y,
      month: m,
      publicHolidays,
      dateOfJoining: doj,
      dateOfLeaving: dol,
    });

    // ── LOG BLOCK 3: dump the day map ───────────────────────────
    console.log(`\n${TAG} ─── 4. DAY MAP RETURNED ───`);
    const dayKeys = Object.keys(dayMap).sort();
    console.log(`  total days in map: ${dayKeys.length}`);
    const statusCounts = {};
    const skipCounts = {};
    for (const k of dayKeys) {
      const d = dayMap[k];
      statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
      if (d.skip) skipCounts[d.status] = (skipCounts[d.status] || 0) + 1;
    }
    console.log(`  status counts:`, statusCounts);
    console.log(`  skipped counts:`, skipCounts);

    // Print every day compactly for scanning
    console.log(`\n  ── per-day breakdown ──`);
    for (const k of dayKeys) {
      const d = dayMap[k];
      const flags = [
        d.skip ? 'SKIP' : '',
        d.isWeekend ? 'WEEKEND' : '',
        d.isHoliday ? 'HOLIDAY' : '',
      ].filter(Boolean).join(',') || '—';
      console.log(
        `    ${k}  dow=${d.dayOfWeek}  status=${String(d.status).padEnd(14)}` +
        ` payable=${String(d.payableFraction).padEnd(4)}  [${flags}]`
      );
    }

    // ── 6. Aggregate into counters ───────────────────────────────
    const summary = summarize(dayMap, {
      paidWeekends,
      paidHolidays,
      paidLeaves,
      latePenalty,
      shortPenalty,
      graceMinutes,
      halfDayLateMin,
    });

    // ── LOG BLOCK 4: summary ────────────────────────────────────
    console.log(`\n${TAG} ─── 5. SUMMARY ───`);
    console.log(JSON.stringify(summary, null, 2));

    // ── 7. Proration ratio (employment-aware) ────────────────────
    const calendarDays = summary.calendarDays || 30;
    const ratio = calendarDays > 0
      ? round2(summary.payableDays / calendarDays)
      : 0;

    console.log(`\n${TAG} ─── 6. PRORATION (calendar-based) ───`);
    console.log(`  payableDays:    ${summary.payableDays}`);
    console.log(`  calendarDays:   ${calendarDays}`);
    console.log(`  ratio:          ${ratio}   (${summary.payableDays} / ${calendarDays})`);
    console.log(`  employedDays:   ${summary.employedDays}  (audit only)`);
    console.log(`  preJoiningDays: ${summary.preJoiningDays}`);
    console.log(`  postLeavingDays:${summary.postLeavingDays}`);

    /** Prorate a monthly base amount by the attendance ratio */
    const earned = (base) => round2((base || 0) * ratio);

    // ── 8. Prorated earnings ─────────────────────────────────────
    const earnedBasic = earned(salary.basic);
    const earnedHra = earned(salary.hra);
    const earnedMedical = earned(salary.medicalConveyance);
    const earnedConveyance = earned(salary.conveyanceAllowance);
    const earnedSpecial = earned(salary.specialAllowance);
    const earnedGratuity = earned(salary.gratuity);

    console.log(`\n${TAG} ─── 7. EARNINGS (prorated by ${ratio}) ───`);
    console.log(`  basic:       ${salary.basic} → ${earnedBasic}`);
    console.log(`  hra:         ${salary.hra} → ${earnedHra}`);
    console.log(`  medical:     ${salary.medicalConveyance} → ${earnedMedical}`);
    console.log(`  conveyance:  ${salary.conveyanceAllowance} → ${earnedConveyance}`);
    console.log(`  special:     ${salary.specialAllowance} → ${earnedSpecial}`);

    // ── 9. Statutory components ──────────────────────────────────
    const epfRate = pfRate != null ? Number(pfRate) : EPF_RATE_DEFAULT;
    const epfWageBaseRaw = Math.min(salary.basic, EPF_WAGE_CEILING);
    const epfWageBase = round2(epfWageBaseRaw * ratio);

    const employeeEPF = salary.employeeEPF > 0
      ? earned(salary.employeeEPF)
      : round2(epfWageBase * epfRate);

    const employerEPF = salary.employerEPF > 0
      ? earned(salary.employerEPF)
      : round2(epfWageBase * epfRate);

    const grossForFund = earnedBasic + earnedHra + earnedMedical
      + earnedConveyance + earnedSpecial;
    const benevolentFund = salary.benevolentFund > 0
      ? earned(salary.benevolentFund)
      : round2(grossForFund * BENEVOLENT_FUND_RATE_DEFAULT);

    const tax = round2(earnedBasic * Number(taxRate));

    console.log(`\n${TAG} ─── 8. STATUTORY ───`);
    console.log(`  epfWageBase:    ${epfWageBase} (min(${salary.basic}, ${EPF_WAGE_CEILING}) × ${ratio})`);
    console.log(`  employeeEPF:    ${employeeEPF}`);
    console.log(`  employerEPF:    ${employerEPF}`);
    console.log(`  benevolentFund: ${benevolentFund}`);
    console.log(`  tax:            ${tax}`);

    // ── 10. Late penalty (per-minute) ────────────────────────────
    let lateDeduction = 0;
    if (latePenalty === 'deduct-minutes' && summary.totalLateMinutes > 0) {
      const perMinute = lateDeductionPerMinute > 0
        ? lateDeductionPerMinute
        : (earnedBasic / (employedDays * 8 * 60));
      lateDeduction = round2(summary.totalLateMinutes * perMinute);
    }

    // ── 11. Create payroll record ────────────────────────────────
    const payroll = new Payroll({
      employee: employeeId,
      month: m,
      year: y,

      earnings: {
        basicSalary: earnedBasic,
        hra: earnedHra,
        medical: earnedMedical,
        conveyance: earnedConveyance,
        specialAllowance: earnedSpecial,
        transport: 0,
        employerEPF,
        bonus,
        overtime,
        other: otherEarnings,
      },

      deductions: {
        pf: employeeEPF,
        benevolentFund,
        gratuity: earnedGratuity,
        tax,
        pt,
        insurance,
        advance,
        other: round2(otherDeductions + lateDeduction),
      },

      attendance: {
        workDays: summary.workDays,
        presentDays: summary.presentDays,
        absentDays: summary.absentDays,
        leaveDays: summary.leaveDays,
        halfDays: summary.halfDays,
        offDays: summary.weekendDays,
        publicHolidays: summary.holidayDays,
        payableDays: summary.payableDays,

        lateDays: summary.lateDays,
        totalLateMinutes: summary.totalLateMinutes,
        shortDays: summary.shortDays,
        totalShortMinutes: summary.totalShortMinutes,
        comboOffDays: summary.comboOffDays,
        lateDeduction,

        employedDays: summary.employedDays,
        calendarDays: summary.calendarDays,
        preJoiningDays: summary.preJoiningDays,
        postLeavingDays: summary.postLeavingDays,
        prorationRatio: round2(ratio),
        dateOfJoining: doj,
        dateOfLeaving: dol,
      },

      generatedBy: req.user.id,
      status: 'draft',
    });

    // Force Mongoose to persist the whole nested tree
    payroll.markModified('earnings');
    payroll.markModified('deductions');
    payroll.markModified('attendance');

    await payroll.save();

    await payroll.populate([
      { path: 'employee', select: 'firstName lastName employeeId email department' },
      { path: 'generatedBy', select: 'firstName lastName' },
    ]);

    console.log(`\n${TAG} ─── 9. SAVED ───`);
    console.log(`  payroll._id:               ${payroll._id}`);
    console.log(`  attendance.employedDays:   ${payroll.attendance?.employedDays}`);
    console.log(`  attendance.payableDays:    ${payroll.attendance?.payableDays}`);
    console.log(`  attendance.prorationRatio: ${payroll.attendance?.prorationRatio}`);
    console.log(`  earnings.basicSalary:      ${payroll.earnings?.basicSalary}`);
    console.log(`  netSalary:                 ${payroll.netSalary}`);
    console.log(`\n${TAG} DONE\n`);

    // Tell the employee their payslip is ready
    await notifyPayslipGenerated(payroll);

    return res.status(201).json({
      success: true,
      message: 'Payroll generated',
      payroll,
    });
  } catch (error) {
    console.error(`${TAG} ERROR:`, error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// @desc    Get all payrolls
// @route   GET /api/payroll
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.getAllPayrolls = async (req, res) => {
  try {
    const { month, year, status, employeeId } = req.query;
    const query = {};
    if (month) query.month = month;
    if (year) query.year = year;
    if (status) query.status = status;
    if (employeeId) query.employee = employeeId;

    const payrolls = await Payroll.find(query)
      .populate('employee', 'firstName lastName employeeId email department')
      .populate('generatedBy', 'firstName lastName')
      .sort({ year: -1, month: -1 });

    res.status(200).json({
      success: true,
      count: payrolls.length,
      payrolls
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Get single payroll by ID
// @route   GET /api/payroll/:id
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.getPayrollById = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email department')
      .populate('generatedBy', 'firstName lastName')
      .populate('paidBy', 'firstName lastName');

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    // Employees can only see their own payroll
    const isOwner =
      payroll.employee._id.toString() === req.user.id.toString();
    const isHr = ['hr', 'admin'].includes(req.user.role);

    if (!isOwner && !isHr) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this payroll'
      });
    }

    res.status(200).json({ success: true, payroll });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Get my payroll
// @route   GET /api/payroll/my-payroll
// @access  Private
// ─────────────────────────────────────────────
exports.getMyPayroll = async (req, res) => {
  try {
    const { month, year } = req.query;
    const query = { employee: req.user.id };
    if (month) query.month = month;
    if (year) query.year = year;

    const payrolls = await Payroll.find(query).sort({ year: -1, month: -1 });

    res.status(200).json({
      success: true,
      count: payrolls.length,
      payrolls
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Update payroll
// @route   PUT /api/payroll/:id
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.updatePayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a payroll that has already been paid'
      });
    }

    // Only allow safe fields
    const allowed = ['earnings', 'deductions', 'attendance', 'status'];
    const changedSections = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        payroll[key] = { ...payroll[key].toObject(), ...req.body[key] };
        changedSections.push(key);
      }
    }

    // Trigger recalc + save (hook runs)
    payroll.recalculate();
    await payroll.save();

    await payroll.populate([
      { path: 'employee', select: 'firstName lastName employeeId email department' },
      { path: 'generatedBy', select: 'firstName lastName' }
    ]);

    // A correction changes take-home pay, so the employee must be told.
    if (changedSections.length > 0) {
      await notifyPayrollCorrected(payroll, {
        changedSections,
        changedBy: req.user?.firstName
          ? `${req.user.firstName} ${req.user.lastName || ''}`.trim()
          : undefined,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payroll updated successfully',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Process payroll
// @route   PUT /api/payroll/:id/process
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.processPayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id);

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payroll is already paid'
      });
    }

    payroll.status = 'processed';
    await payroll.save();

    res.status(200).json({
      success: true,
      message: 'Payroll processed successfully',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// @desc    Mark payroll as paid
// @route   PUT /api/payroll/:id/pay
// @access  Private (HR, Admin)
// ─────────────────────────────────────────────
exports.markAsPaid = async (req, res) => {
  try {
    const { paymentMethod, transactionId } = req.body;

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'paymentMethod is required'
      });
    }

    const payroll = await Payroll.findById(req.params.id);

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payroll already marked as paid'
      });
    }

    payroll.status = 'paid';
    payroll.paidOn = Date.now();
    payroll.paymentMethod = paymentMethod;
    payroll.transactionId = transactionId;
    payroll.paidBy = req.user.id;
    await payroll.save();

    await payroll.populate([
      { path: 'employee', select: 'firstName lastName employeeId' },
      { path: 'paidBy', select: 'firstName lastName' }
    ]);

    await notifySalaryPaid(payroll, { paymentMethod, transactionId });

    res.status(200).json({
      success: true,
      message: 'Payroll marked as paid',
      payroll
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};