const moment = require("moment-timezone");
const TZ = "Asia/Kolkata";
const TIMEZONE = TZ;

// ============================================================
// CURRENT IST TIME
// ============================================================

const nowIST = () => moment().tz(TIMEZONE);
const getISTDate = () => nowIST().toDate();
const getISTMidnight = () => nowIST().startOf("day").toDate();
const getISTStandardTime = () =>
  nowIST()
    .set({
      hour: 10,
      minute: 0,
      second: 0,
      millisecond: 0,
    })
    .toDate();

const getISTStandardCheckoutTime = () =>
  nowIST()
    .set({
      hour: 18,
      minute: 0,
      second: 0,
      millisecond: 0,
    })
    .toDate();

const getISTAutoCheckoutTime = () =>
  nowIST()
    .set({
      hour: 21,
      minute: 0,
      second: 0,
      millisecond: 0,
    })
    .toDate();

// ============================================================
// DATE PARSING / VALIDATION
// ============================================================

/**
 * Parse a value as an IST calendar date at 00:00:00.
 */
const parseIST = (input) =>
  moment.tz(input, TIMEZONE).startOf("day");

/**
 * Convert any date/timestamp to an IST date key.
 *
 * Example:
 * 2026-09-24T18:30:00.000Z
 * => 2026-09-25
 */
const toISTKey = (input) =>
  moment(input).tz(TIMEZONE).format("YYYY-MM-DD");

const toISTDisplay = toISTKey;

const isValidIST = (m) =>
  moment.isMoment(m) && m.isValid();


// ============================================================
// DAY RANGES
// ============================================================

/**
 * Start of the given day in IST.
 */
const getStartOfDay = (date = new Date()) =>
  moment(date).tz(TIMEZONE).startOf("day").toDate();

/**
 * End of the given day in IST.
 */
const getEndOfDay = (date = new Date()) =>
  moment(date).tz(TIMEZONE).endOf("day").toDate();

/**
 * Start of current month / given date's month in IST.
 */
const getStartOfMonth = (date = new Date()) =>
  moment(date).tz(TIMEZONE).startOf("month").toDate();

/**
 * End of current month / given date's month in IST.
 */
const getEndOfMonthDate = (date = new Date()) =>
  moment(date).tz(TIMEZONE).endOf("month").toDate();


// ============================================================
// MONTH RANGES
// ============================================================

/**
 * Get month start from numeric year/month.
 *
 * month = 1 -> January
 * month = 12 -> December
 */
const getMonthStart = (year, month) =>
  moment
    .tz(
      {
        year: Number(year),
        month: Number(month) - 1,
        date: 1,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      TIMEZONE
    )
    .toDate();

/**
 * Get month end from numeric year/month.
 */
const getMonthEnd = (year, month) =>
  moment
    .tz(
      {
        year: Number(year),
        month: Number(month) - 1,
        date: 1,
      },
      TIMEZONE
    )
    .endOf("month")
    .toDate();

const getEndOfMonth = (year, month) =>
  getMonthEnd(year, month);


// ============================================================
// YEAR RANGES
// ============================================================

const getStartOfYear = (year = nowIST().year()) =>
  moment
    .tz(
      {
        year: Number(year),
        month: 0,
        date: 1,
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      TIMEZONE
    )
    .toDate();

const getEndOfYear = (year = nowIST().year()) =>
  moment
    .tz(
      {
        year: Number(year),
        month: 11,
        date: 31,
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
      },
      TIMEZONE
    )
    .toDate();

/**
 * Returns:
 * {
 *   start: Date,
 *   end: Date
 * }
 *
 * covering the complete calendar year in IST.
 */
const yearRangeIST = (year) => {
  const y = Number(year);

  return {
    start: getStartOfYear(y),
    end: getEndOfYear(y),
  };
};


// ============================================================
// MONTH / YEAR QUERY PARSING
// ============================================================

const parseMonthYear = (query = {}) => {
  const now = nowIST();

  const parsedYear = parseInt(query.year, 10);
  const parsedMonth = parseInt(query.month, 10);

  const year =
    Number.isInteger(parsedYear) && parsedYear > 0
      ? parsedYear
      : now.year();

  const month =
    Number.isInteger(parsedMonth) &&
    parsedMonth >= 1 &&
    parsedMonth <= 12
      ? parsedMonth
      : now.month() + 1;

  return {
    year,
    month,
  };
};

const getMonthName = (year, monthIndex) =>
  moment
    .tz(
      {
        year: Number(year),
        month: Number(monthIndex),
        date: 1,
      },
      TIMEZONE
    )
    .format("MMM");


// ============================================================
// IST DATE KEYS
// ============================================================

const getISTDay = (date = new Date()) =>
  moment(date).tz(TIMEZONE).day();

const getISTDateString = (date = new Date()) =>
  moment(date).tz(TIMEZONE).format("YYYY-MM-DD");

const getTodayIST = () =>
  nowIST().format("YYYY-MM-DD");


// ============================================================
// DATE FORMATTING
// ============================================================

const formatISTTime = (date) =>
  date
    ? moment(date).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss")
    : null;

const formatISTDate = (date) =>
  date
    ? moment(date).tz(TIMEZONE).format("DD MMM YYYY")
    : null;


// ============================================================
// LEAVE DAY UTILITIES
// ============================================================

/**
 * IST day keys between start/end inclusive,
 * excluding dates present in excludeSet.
 */
const buildLeaveDayKeys = (
  start,
  end,
  excludeSet = new Set()
) => {
  const keys = [];
  const cur = start.clone();

  while (cur.isSameOrBefore(end, "day")) {
    const key = cur.format("YYYY-MM-DD");

    if (!excludeSet.has(key)) {
      keys.push(key);
    }

    cur.add(1, "day");
  }

  return keys;
};

/**
 * True if the IST day key falls on Saturday or Sunday.
 */
const isWeekendKey = (key) => {
  const dow = moment.tz(key, TIMEZONE).day();

  return dow === 0 || dow === 6;
};


// ============================================================
// ATTENDANCE / WORK HOURS
// ============================================================

/**
 * Calculate current work hours for an attendance record.
 *
 * If checkout exists:
 *   uses stored attendance.workHours
 *
 * If checkout doesn't exist:
 *   calculates from check-in until current IST time.
 */
const getCurrentWorkHours = (attendance) => {
  if (!attendance?.checkIn?.time) {
    return 0;
  }

  const now = nowIST();

  const checkIn = moment(attendance.checkIn.time).tz(TIMEZONE);

  if (attendance.checkOut?.time) {
    return parseFloat(
      Number(attendance.workHours || 0).toFixed(2)
    );
  }

  return parseFloat(
    (now.diff(checkIn, "minutes") / 60).toFixed(2)
  );
};


/**
 * Compute working hours between two timestamps.
 */
const computeWorkHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) {
    return 0;
  }

  const inT = moment(checkIn).tz(TIMEZONE);
  const outT = moment(checkOut).tz(TIMEZONE);

  const mins = outT.diff(inT, "minutes");

  if (mins <= 0) {
    return 0;
  }

  return parseFloat(
    (mins / 60).toFixed(2)
  );
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Timezone
  TZ,
  TIMEZONE,

  // Current time
  nowIST,
  getISTDate,
  getISTMidnight,
  getISTStandardTime,
  getISTStandardCheckoutTime,
  getISTAutoCheckoutTime,

  // Parsing / validation
  parseIST,
  toISTKey,
  toISTDisplay,
  isValidIST,

  // Day ranges
  getStartOfDay,
  getEndOfDay,

  // Month ranges
  getStartOfMonth,
  getEndOfMonthDate,
  getMonthStart,
  getMonthEnd,
  getEndOfMonth,

  // Year ranges
  getStartOfYear,
  getEndOfYear,
  yearRangeIST,

  // Month / year helpers
  parseMonthYear,
  getMonthName,

  // Date helpers
  getISTDay,
  getISTDateString,
  getTodayIST,
  formatISTTime,
  formatISTDate,

  // Leave helpers
  buildLeaveDayKeys,
  isWeekendKey,

  // Attendance helpers
  getCurrentWorkHours,
  computeWorkHours,
};