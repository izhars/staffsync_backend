// utils/expenseNotifications.js
//
// Expense claim notifications: employee submissions reach approvers, and
// decisions/reimbursements reach the claimant.
//
// All sends are best-effort (see utils/notify.js) so a push failure can never
// roll back or 500 an expense action.

const { notifyUser, notifyUsers } = require('./notify');

const formatAmount = (amount, currency = 'INR') => {
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

const categoryLabel = (expense) =>
  expense?.category?.name || expense?.category || 'expense';

/**
 * An employee submitted a claim → tell the approvers.
 * @param {Array} approverIds HR/admin/manager user ids
 */
async function notifyExpenseSubmitted(approverIds, expense, employeeName) {
  return notifyUsers(approverIds, {
    title: '🧾 New Expense Claim',
    body: `${employeeName || 'An employee'} submitted a ${categoryLabel(expense)} claim for ${formatAmount(expense?.amount, expense?.currency)}.`,
    type: 'expense',
    data: {
      action: 'expense_submitted',
      expenseId: String(expense?._id ?? ''),
      amount: String(expense?.amount ?? ''),
    },
  });
}

/** The claimant's expense was approved. */
async function notifyExpenseApproved(expense, { comments } = {}) {
  return notifyUser(expense?.employee, {
    title: '✅ Expense Approved',
    body: `Your ${categoryLabel(expense)} claim of ${formatAmount(expense?.amount, expense?.currency)} was approved.${comments ? ` Note: ${comments}` : ''}`,
    type: 'expense',
    data: {
      action: 'expense_approved',
      expenseId: String(expense?._id ?? ''),
      status: 'approved',
    },
  });
}

/** The claimant's expense was rejected / returned for editing. */
async function notifyExpenseRejected(expense, { reason } = {}) {
  return notifyUser(expense?.employee, {
    title: '❌ Expense Rejected',
    body: `Your ${categoryLabel(expense)} claim of ${formatAmount(expense?.amount, expense?.currency)} was returned.${reason ? ` Reason: ${reason}` : ''}`,
    type: 'expense',
    data: {
      action: 'expense_rejected',
      expenseId: String(expense?._id ?? ''),
      status: 'rejected',
      ...(reason && { reason }),
    },
  });
}

/** The claim was paid out. */
async function notifyExpenseReimbursed(expense, { transactionId } = {}) {
  return notifyUser(expense?.employee, {
    title: '💰 Expense Reimbursed',
    body: `Your ${categoryLabel(expense)} claim of ${formatAmount(expense?.amount, expense?.currency)} has been reimbursed.${transactionId ? ` Ref: ${transactionId}` : ''}`,
    type: 'expense',
    data: {
      action: 'expense_reimbursed',
      expenseId: String(expense?._id ?? ''),
      status: 'reimbursed',
      ...(transactionId && { transactionId }),
    },
  });
}

/**
 * Bulk decision summary for one claimant (used by bulkApproveExpenses).
 * @param {string} employeeId
 * @param {Array} expenses the affected claims
 * @param {'approved'|'rejected'} status
 */
async function notifyExpenseBulkDecision(employeeId, expenses = [], status = 'approved') {
  if (!employeeId || expenses.length === 0) return { sent: 0, failed: 0 };

  const total = expenses.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  const approved = status === 'approved';

  return notifyUser(employeeId, {
    title: approved ? '✅ Expenses Approved' : '❌ Expenses Returned',
    body: approved
      ? `${expenses.length} expense claim(s) totalling ${formatAmount(total)} were approved.`
      : `${expenses.length} expense claim(s) were returned for changes.`,
    type: 'expense',
    data: {
      action: approved ? 'expense_bulk_approved' : 'expense_bulk_rejected',
      count: String(expenses.length),
      total: String(total),
    },
  });
}

module.exports = {
  notifyExpenseSubmitted,
  notifyExpenseApproved,
  notifyExpenseRejected,
  notifyExpenseReimbursed,
  notifyExpenseBulkDecision,
  formatAmount,
};
