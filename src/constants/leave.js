// constants/leave.js
module.exports = {
  LEAVE_TYPES: Object.freeze({
    CASUAL: 'casual',
    COMBO: 'combo',
  }),

  LEAVE_STATUS: Object.freeze({
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
  }),

  LEAVE_DURATION: Object.freeze({
    FULL: 'full',
    HALF: 'half',
  }),

  HALF_DAY_TYPE: Object.freeze({
    FIRST: 'first_half',
    SECOND: 'second_half',
  }),

  ATTENDANCE_STATUS: Object.freeze({
    ON_LEAVE: 'on-leave',
    HALF_FIRST: 'half-day-first',
    HALF_SECOND: 'half-day-second',
  }),

  HOLIDAY_CATEGORY: Object.freeze({
    MANDATORY: 'Mandatory',
    RESTRICTED: 'Restricted',
  }),

  RESTRICTED_HOLIDAY_DEFAULT_QUOTA: 2,
  MAX_LEAVE_DAYS_PER_REQUEST: 90,
  MAX_DOCUMENTS: 5,
};