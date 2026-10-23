// scripts/check-payroll-attendance.js
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const Payroll = require('./src/models/Payroll');

(async () => {
  await connectDB();

  const p = await Payroll.findOne({
    employee: '6aabdfe3da1eb364fc12b609',
    month: 9,
    year: 2026,
  }).lean();

  if (!p) {
    console.log('❌ No payroll found');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  ATTENDANCE BLOCK (from stored payroll)');
  console.log('═══════════════════════════════════════════\n');
  console.log(JSON.stringify(p.attendance, null, 2));

  console.log('\n═══════════════════════════════════════════');
  console.log('  COMPUTED RATIO');
  console.log('═══════════════════════════════════════════\n');
  const { employedDays, payableDays, prorationRatio } = p.attendance || {};
  console.log(`  employedDays   = ${employedDays}`);
  console.log(`  payableDays    = ${payableDays}`);
  console.log(`  prorationRatio = ${prorationRatio}  (${payableDays} / ${employedDays})`);
  console.log(`  dateOfJoining  = ${p.attendance?.dateOfJoining}`);
  console.log(`  dateOfLeaving  = ${p.attendance?.dateOfLeaving}`);

  await mongoose.disconnect();
})();