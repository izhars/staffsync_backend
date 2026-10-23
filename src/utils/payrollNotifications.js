// utils/payrollNotifications.js
//
// Payroll notifications: payslip ready, salary paid, and post-generation
// corrections. Money-related, so body copy always states the amount and the
// pay period explicitly.
//
// All sends are best-effort (see utils/notify.js).

const { notifyUser } = require('./notify');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const periodLabel = (month, year) => {
  const idx = Number(month) - 1;
  const name = MONTHS[idx] || `Month ${month}`;
  return `${name} ${year}`;
};

const formatMoney = (amount, currency = 'INR') => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount ?? '');
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency || 'INR'} ${n.toFixed(2)}`;
  }
};

const payrollId = (payroll) => String(payroll?._id ?? '');
const employeeIdOf = (payroll) => payroll?.employee?._id || payroll?.employee;

/**
 * A payslip was generated and is available for review.
 */
async function notifyPayslipGenerated(payroll) {
  return notifyUser(employeeIdOf(payroll), {
    title: '🧾 Payslip Generated',
    body: `Your payslip for ${periodLabel(payroll?.month, payroll?.year)} is ready. Net pay: ${formatMoney(payroll?.netSalary, payroll?.currency)}.`,
    type: 'payroll',
    data: {
      action: 'payslip_generated',
      payrollId: payrollId(payroll),
      month: String(payroll?.month ?? ''),
      year: String(payroll?.year ?? ''),
      netSalary: String(payroll?.netSalary ?? ''),
    },
  });
}

/**
 * Salary was disbursed.
 */
async function notifySalaryPaid(payroll, { paymentMethod, transactionId } = {}) {
  return notifyUser(employeeIdOf(payroll), {
    title: '💰 Salary Paid',
    body: `Your salary for ${periodLabel(payroll?.month, payroll?.year)} has been paid${transactionId ? ` (Ref: ${transactionId})` : ''}. Amount: ${formatMoney(payroll?.netSalary, payroll?.currency)}.`,
    type: 'payroll',
    data: {
      action: 'salary_paid',
      payrollId: payrollId(payroll),
      month: String(payroll?.month ?? ''),
      year: String(payroll?.year ?? ''),
      netSalary: String(payroll?.netSalary ?? ''),
      ...(paymentMethod && { paymentMethod }),
      ...(transactionId && { transactionId }),
    },
  });
}

/**
 * An HR correction changed this payroll record after it was generated.
 * @param {string[]} changedSections e.g. ['earnings', 'deductions']
 */
async function notifyPayrollCorrected(payroll, { changedSections = [], changedBy } = {}) {
  const what = changedSections.length
    ? changedSections.join(', ')
    : 'salary details';

  return notifyUser(employeeIdOf(payroll), {
    title: '✏️ Payslip Updated',
    body: `Your payslip for ${periodLabel(payroll?.month, payroll?.year)} was updated (${what})${changedBy ? ` by ${changedBy}` : ''}. Net pay is now ${formatMoney(payroll?.netSalary, payroll?.currency)}.`,
    type: 'payroll',
    data: {
      action: 'payroll_corrected',
      payrollId: payrollId(payroll),
      month: String(payroll?.month ?? ''),
      year: String(payroll?.year ?? ''),
      netSalary: String(payroll?.netSalary ?? ''),
      changedSections: changedSections.join(','),
    },
  });
}

/**
 * Bulk payslip announcement for a payroll run.
 */
async function notifyPayslipsGenerated(employeeIds = [], { month, year } = {}) {
  const { notifyUsers } = require('./notify');
  return notifyUsers(employeeIds, {
    title: '🧾 Payslips Generated',
    body: `Payslips for ${periodLabel(month, year)} have been generated. Open the app to review yours.`,
    type: 'payroll',
    data: {
      action: 'payslips_generated',
      month: String(month ?? ''),
      year: String(year ?? ''),
    },
  });
}

module.exports = {
  notifyPayslipGenerated,
  notifySalaryPaid,
  notifyPayrollCorrected,
  notifyPayslipsGenerated,
  periodLabel,
  formatMoney,
};
