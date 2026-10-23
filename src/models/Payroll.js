const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  month: { type: Number, required: true, min: 1, max: 12 },
  year:  { type: Number, required: true },

  // ─────────────────────────────────────────────
  // Earnings (prorated for the month)
  // ─────────────────────────────────────────────
  earnings: {
    basicSalary:      { type: Number, required: true, default: 0 },
    hra:              { type: Number, default: 0 },
    medical:          { type: Number, default: 0 },   // Medical Conveyance
    conveyance:       { type: Number, default: 0 },   // Conveyance Allowance
    specialAllowance: { type: Number, default: 0 },
    transport:        { type: Number, default: 0 },   // legacy — kept for back-compat

    employerEPF:      { type: Number, default: 0 },   // B — for CTC

    bonus:            { type: Number, default: 0 },
    overtime:         { type: Number, default: 0 },
    other:            { type: Number, default: 0 },

    // Computed (cached)
    grossSalary:      { type: Number, default: 0 },   // A
    costToCompany:    { type: Number, default: 0 },   // A + B
    total:            { type: Number, default: 0 },   // Gross + extras
  },

  // ─────────────────────────────────────────────
  // Deductions
  // ─────────────────────────────────────────────
  deductions: {
    pf:              { type: Number, default: 0 },    // C — Employee EPF
    benevolentFund:  { type: Number, default: 0 },    // D
    gratuity:        { type: Number, default: 0 },    // informational
    tax:             { type: Number, default: 0 },    // TDS
    pt:              { type: Number, default: 0 },    // Professional Tax
    insurance:       { type: Number, default: 0 },
    advance:         { type: Number, default: 0 },
    other:           { type: Number, default: 0 },

    // Computed
    total:           { type: Number, default: 0 },
  },

  // ─────────────────────────────────────────────
  // Attendance snapshot (audit)
  // ─────────────────────────────────────────────
  attendance: {
    // Core counters
    workDays:          { type: Number, default: 0 },
    presentDays:       { type: Number, default: 0 },
    absentDays:        { type: Number, default: 0 },
    leaveDays:         { type: Number, default: 0 },
    halfDays:          { type: Number, default: 0 },
    offDays:           { type: Number, default: 0 },
    publicHolidays:    { type: Number, default: 0 },
    payableDays:       { type: Number, default: 0 },

    // Late / short
    lateDays:          { type: Number, default: 0 },
    totalLateMinutes:  { type: Number, default: 0 },
    shortDays:         { type: Number, default: 0 },
    totalShortMinutes: { type: Number, default: 0 },
    comboOffDays:      { type: Number, default: 0 },
    lateDeduction:     { type: Number, default: 0 },

    // Employment window audit
    employedDays:      { type: Number, default: 0 },  
    calendarDays:      { type: Number, default: 0 },
    preJoiningDays:    { type: Number, default: 0 },
    postLeavingDays:   { type: Number, default: 0 },
    prorationRatio:    { type: Number, default: 1 },
    dateOfJoining:     { type: Date,   default: null },
    dateOfLeaving:     { type: Date,   default: null },
  },

  // ─────────────────────────────────────────────
  // Final numbers
  // ─────────────────────────────────────────────
  netSalary: { type: Number, required: true, default: 0 },

  status: {
    type: String,
    enum: ['draft', 'processed', 'paid'],
    default: 'draft',
  },

  paidOn:        Date,
  paymentMethod: { type: String, enum: ['bank-transfer', 'cash', 'cheque'] },
  transactionId: String,

  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true,
});

// Unique payroll per employee per month/year
payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

// ─────────────────────────────────────────────
// Recalculation
// ─────────────────────────────────────────────
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function recalc(doc) {
  const e = doc.earnings   || {};
  const d = doc.deductions || {};

  // ── Gross (A) ──
  const gross =
    (e.basicSalary      || 0) +
    (e.hra              || 0) +
    (e.medical          || 0) +
    (e.conveyance       || 0) +
    (e.specialAllowance || 0);

  // ── Total earnings (Gross + extras) ──
  const totalEarnings =
    gross +
    (e.bonus    || 0) +
    (e.overtime || 0) +
    (e.other    || 0);

  // ── CTC (A + B) ──
  const ctc = gross + (e.employerEPF || 0);

  // ── Total deductions (C + D + extras) ──
  const totalDeductions =
    (d.pf             || 0) +
    (d.benevolentFund || 0) +
    (d.tax            || 0) +
    (d.pt             || 0) +
    (d.insurance      || 0) +
    (d.advance        || 0) +
    (d.other          || 0);

  // ── Net Payable (A − (C + D + extras)) ──
  doc.earnings.grossSalary    = round2(gross);
  doc.earnings.total          = round2(totalEarnings);
  doc.earnings.costToCompany  = round2(ctc);
  doc.deductions.total        = round2(totalDeductions);
  doc.netSalary               = round2(totalEarnings - totalDeductions);
}

// ─────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────

// Instance method — call before save() if you want to force a recalc
payrollSchema.methods.recalculate = function () {
  recalc(this);
  return this;
};

// Runs on .save()
payrollSchema.pre('save', function (next) {
  recalc(this);
  next();
});

// Runs on findOneAndUpdate / findByIdAndUpdate
payrollSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  if (
    update.earnings || update.deductions ||
    update.$set?.earnings || update.$set?.deductions
  ) {
    this._recalcAfterUpdate = true;
  }
  next();
});

payrollSchema.post('findOneAndUpdate', async function (doc) {
  if (this._recalcAfterUpdate && doc) {
    recalc(doc);
    await doc.save(); // triggers pre('save') again — safe & idempotent
  }
});

// ─────────────────────────────────────────────
// Virtuals
// ─────────────────────────────────────────────
payrollSchema.virtual('grossSalary').get(function () {
  return this.earnings?.grossSalary || this.earnings?.total || 0;
});

payrollSchema.set('toJSON',   { virtuals: true });
payrollSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Payroll', payrollSchema);