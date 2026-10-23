// scripts/seed-sharique-salary.js
//
// One-off seed script to update Sharique Izhar's (SCAIPLH006)
// salary to match Annexure-I of his offer letter.
//
// Run:
//   node scripts/seed-sharique-salary.js
//
// Safe to re-run — idempotent.

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const User = require('./src//models/User');

// ─────────────────────────────────────────────────────────────
// Target salary — matches the salary slip exactly
// ─────────────────────────────────────────────────────────────
const TARGET_SALARY = {
  // ── Earnings ──
  basic:               19500,
  hra:                 9750,
  medicalConveyance:   1200,
  conveyanceAllowance: 1600,
  specialAllowance:    5100,

  // ── Statutory ──
  employerEPF:         1800,
  employeeEPF:         1800,
  gratuity:            0,
  benevolentFund:      372,

  // ── Cached computed (will be recomputed by calculateNetSalary) ──
  grossSalary:         0,   // filled by calculateNetSalary
  costToCompany:       0,   // filled by calculateNetSalary
  netSalary:           0,   // filled by calculateNetSalary

  currency:            'INR',
  payFrequency:        'monthly',
};

const EMPLOYEE_ID = 'SCAIPLH006';

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────
(async () => {
  try {
    await connectDB();

    const user = await User.findOne({ employeeId: EMPLOYEE_ID });
    if (!user) {
      console.error(`❌ User not found: ${EMPLOYEE_ID}`);
      process.exit(1);
    }

    console.log('\n─── BEFORE ───');
    console.log(`${user.firstName} ${user.lastName} (${user.employeeId})`);
    console.log(JSON.stringify(user.salary, null, 2));

    // Replace the whole salary subdoc with the new shape.
    // Old fields (`transport`, `allowances`, `deductions`) are dropped
    // automatically because we're assigning a fresh object.
    user.salary = { ...TARGET_SALARY };

    // Recompute gross / CTC / net using the model method
    user.calculateNetSalary();

    // markModified so Mongoose persists the nested change reliably
    user.markModified('salary');

    await user.save();

    console.log('\n─── AFTER ───');
    console.log(JSON.stringify(user.salary, null, 2));

    console.log('\n✅ Salary updated successfully.');
    console.log(`   Gross (A):       ₹${user.salary.grossSalary.toLocaleString('en-IN')}`);
    console.log(`   CTC (A+B):       ₹${user.salary.costToCompany.toLocaleString('en-IN')}`);
    console.log(`   Net (A-(C+D)):   ₹${user.salary.netSalary.toLocaleString('en-IN')}`);

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
})();