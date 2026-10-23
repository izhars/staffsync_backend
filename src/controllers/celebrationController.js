const User = require('../models/User');
const Department = require('../models/Department');
const CelebrationGreeting = require('../models/CelebrationGreeting'); // ─── NEW
const emailService = require('../services/emailService');             // ─── NEW
const moment = require('moment');

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────
const QUERY_TIMEOUT_MS = 5000;
const MAX_UPCOMING_DAYS = 30;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_UPCOMING_DAYS = 7;

const DATE_FIELDS = {
  birthday: 'dateOfBirth',
  marriage: 'marriageAnniversary',
  work: 'dateOfJoining',
};

// ─── NEW ─── how regards are delivered
// 'immediate' = one email per greeting at send-time
// 'digest'    = batched daily email per recipient (cron calls sendRegardsDigestEmail)
const REGARDS_DELIVERY_MODE = process.env.REGARDS_DELIVERY_MODE || 'immediate';

// ────────────────────────────────────────────────────────────────
// Helpers (unchanged)
// ────────────────────────────────────────────────────────────────
const withTimeout = (promise, ms = QUERY_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
    ),
  ]);

const buildBaseMatch = (dateField, filters) => ({
  [dateField]: { $exists: true, $ne: null },
  isActive: true,
  ...filters,
});

const buildTodayPipeline = (dateField, filters, month, day, skip, limit) => [
  { $match: buildBaseMatch(dateField, filters) },
  {
    $addFields: {
      celebrationMonth: { $month: `$${dateField}` },
      celebrationDay: { $dayOfMonth: `$${dateField}` },
    },
  },
  { $match: { celebrationMonth: month, celebrationDay: day } },
  {
    $project: {
      employeeId: 1,
      firstName: 1,
      lastName: 1,
      fullName: 1,
      email: 1,
      department: 1,
      designation: 1,
      dateOfBirth: 1,
      marriageAnniversary: 1,
      dateOfJoining: 1,
      maritalStatus: 1,
    },
  },
  { $sort: { firstName: 1 } },
  { $skip: skip },
  { $limit: limit },
  {
    $lookup: {
      from: 'departments',
      localField: 'department',
      foreignField: '_id',
      as: 'department',
      pipeline: [{ $project: { name: 1 } }],
    },
  },
  { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
];

const buildUpcomingPipeline = (dateField, filters, today, endDate, skip, limit) => [
  { $match: buildBaseMatch(dateField, filters) },
  {
    $addFields: {
      dayOfYear: {
        $dayOfYear: {
          $dateFromParts: {
            year: today.year(),
            month: { $month: `$${dateField}` },
            day: { $dayOfMonth: `$${dateField}` },
          },
        },
      },
    },
  },
  {
    $match: {
      dayOfYear: { $gt: today.dayOfYear(), $lte: endDate.dayOfYear() },
    },
  },
  {
    $project: {
      employeeId: 1,
      firstName: 1,
      lastName: 1,
      fullName: 1,
      email: 1,
      department: 1,
      designation: 1,
      dayOfYear: 1,
      maritalStatus: 1,
      [`${dateField}`]: `$${dateField}`,
    },
  },
  { $sort: { dayOfYear: 1 } },
  { $skip: skip },
  { $limit: limit },
  {
    $lookup: {
      from: 'departments',
      localField: 'department',
      foreignField: '_id',
      as: 'department',
      pipeline: [{ $project: { name: 1 } }],
    },
  },
  { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
];

const getTodayCelebrations = async (dateField, filters, date, limit, skip) => {
  try {
    const month = date.month() + 1;
    const day = date.date();
    return await withTimeout(
      User.aggregate(buildTodayPipeline(dateField, filters, month, day, skip, limit))
    );
  } catch (err) {
    console.error(`getTodayCelebrations(${dateField}) failed:`, err.message);
    return [];
  }
};

const getUpcomingCelebrations = async (dateField, days, filters, limit, skip) => {
  try {
    const today = moment();
    const endDate = moment().add(days, 'days');
    return await withTimeout(
      User.aggregate(buildUpcomingPipeline(dateField, filters, today, endDate, skip, limit))
    );
  } catch (err) {
    console.error(`getUpcomingCelebrations(${dateField}) failed:`, err.message);
    return [];
  }
};

const countTodayCelebrations = async (dateField, filters, date) => {
  try {
    const month = date.month() + 1;
    const day = date.date();
    const result = await withTimeout(
      User.aggregate([
        { $match: buildBaseMatch(dateField, filters) },
        {
          $addFields: {
            celebrationMonth: { $month: `$${dateField}` },
            celebrationDay: { $dayOfMonth: `$${dateField}` },
          },
        },
        { $match: { celebrationMonth: month, celebrationDay: day } },
        { $count: 'total' },
      ])
    );
    return result[0]?.total || 0;
  } catch (err) {
    console.error(`countTodayCelebrations(${dateField}) failed:`, err.message);
    return 0;
  }
};

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
};

const parseDate = (query) => {
  if (!query.date) return moment();
  const d = moment(query.date, 'YYYY-MM-DD', true);
  return d.isValid() ? d : null;
};

const parseUpcomingDays = (query, defaultVal = DEFAULT_UPCOMING_DAYS) => {
  const days = parseInt(query.upcomingDays, 10) || defaultVal;
  if (days < 1 || days > MAX_UPCOMING_DAYS) return null;
  return days;
};

const resolveDepartmentFilter = async (departmentId) => {
  if (!departmentId) return { filter: {}, error: null };
  // ─── NEW: guard against invalid ObjectId → 400 not 500
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(departmentId)) {
    return { filter: {}, error: { status: 400, message: 'Invalid department ID' } };
  }
  const exists = await Department.findById(departmentId).lean();
  if (!exists) {
    return { filter: {}, error: { status: 400, message: 'Invalid department ID' } };
  }
  return { filter: { department: departmentId }, error: null };
};

const enrichUpcoming = (user, date, dateField) => {
  const raw = user[dateField];
  if (!raw) return { ...user, celebrationDate: null, daysUntil: null };

  const original = moment(raw);

  let celebration = moment(date)
    .year(date.year())
    .month(original.month())
    .date(original.date())
    .startOf('day');

  if (celebration.isSameOrBefore(date.clone().startOf('day'))) {
    celebration = celebration.add(1, 'year');
  }

  return {
    ...user,
    celebrationDate: celebration.format('YYYY-MM-DD'),
    daysUntil: celebration.diff(date.clone().startOf('day'), 'days'),
  };
};

const buildBucket = (data, total, page, limit) => ({
  count: data.length,
  total,
  page,
  pages: Math.ceil(total / limit) || 0,
  data,
});

const sendError = (res, error) =>
  res.status(error.status || 400).json({ success: false, error: error.message });

// ────────────────────────────────────────────────────────────────
// Controllers (existing — unchanged)
// ────────────────────────────────────────────────────────────────

exports.getAllTodayCelebrations = async (req, res, next) => {
  try {
    const date = parseDate(req.query);
    if (!date) return sendError(res, { message: 'Invalid date format. Use YYYY-MM-DD' });

    const { page, limit, skip } = parsePagination(req.query);
    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.query.department);
    if (error) return sendError(res, error);

    const filters = { role: 'employee', ...departmentFilter };
    const marriageFilters = { role: 'employee', maritalStatus: 'married', ...departmentFilter };

    const [
      birthdays,
      marriageAnniversaries,
      workAnniversaries,
      totalBirthdays,
      totalMarriageAnniversaries,
      totalWorkAnniversaries,
    ] = await Promise.all([
      getTodayCelebrations(DATE_FIELDS.birthday, filters, date, limit, skip),
      getTodayCelebrations(DATE_FIELDS.marriage, marriageFilters, date, limit, skip),
      getTodayCelebrations(DATE_FIELDS.work, filters, date, limit, skip),
      countTodayCelebrations(DATE_FIELDS.birthday, filters, date),
      countTodayCelebrations(DATE_FIELDS.marriage, marriageFilters, date),
      countTodayCelebrations(DATE_FIELDS.work, filters, date),
    ]);

    const withYears = workAnniversaries.map((u) => ({
      ...u,
      yearsOfService: date.diff(moment(u.dateOfJoining), 'years'),
    }));

    res.status(200).json({
      success: true,
      data: {
        today: {
          birthdays: buildBucket(birthdays, totalBirthdays, page, limit),
          marriageAnniversaries: buildBucket(marriageAnniversaries, totalMarriageAnniversaries, page, limit),
          workAnniversaries: buildBucket(withYears, totalWorkAnniversaries, page, limit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getAllUpComingCelebrations = async (req, res, next) => {
  try {
    const date = parseDate(req.query);
    if (!date) return sendError(res, { message: 'Invalid date format. Use YYYY-MM-DD' });

    const { page, limit, skip } = parsePagination(req.query);
    const upcomingDays = parseUpcomingDays(req.query);
    if (upcomingDays === null) {
      return sendError(res, { message: `Upcoming days must be between 1 and ${MAX_UPCOMING_DAYS}` });
    }

    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.query.department);
    if (error) return sendError(res, error);

    const filters = { role: 'employee', ...departmentFilter };
    const marriageFilters = { role: 'employee', maritalStatus: 'married', ...departmentFilter };

    const [birthdays, marriages, work] = await Promise.all([
      getUpcomingCelebrations(DATE_FIELDS.birthday, upcomingDays, filters, limit, skip),
      getUpcomingCelebrations(DATE_FIELDS.marriage, upcomingDays, marriageFilters, limit, skip),
      getUpcomingCelebrations(DATE_FIELDS.work, upcomingDays, filters, limit, skip),
    ]);

    res.status(200).json({
      success: true,
      data: {
        upcoming: {
          birthdays: birthdays.map((u) => enrichUpcoming(u, date, DATE_FIELDS.birthday)),
          marriageAnniversaries: marriages.map((u) => enrichUpcoming(u, date, DATE_FIELDS.marriage)),
          workAnniversaries: work.map((u) => ({
            ...enrichUpcoming(u, date, DATE_FIELDS.work),
            yearsOfService: date.diff(moment(u.dateOfJoining), 'years'),
          })),
        },
        page,
        limit,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getTodaysBirthdays = async (req, res, next) => {
  try {
    const date = parseDate(req.query);
    if (!date) return sendError(res, { message: 'Invalid date format. Use YYYY-MM-DD' });

    const { page, limit, skip } = parsePagination(req.query);
    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.query.department);
    if (error) return sendError(res, error);

    const includeUpcoming = req.query.includeUpcoming === 'true';
    const upcomingDays = includeUpcoming ? parseUpcomingDays(req.query) : DEFAULT_UPCOMING_DAYS;
    if (includeUpcoming && upcomingDays === null) {
      return sendError(res, { message: `Upcoming days must be between 1 and ${MAX_UPCOMING_DAYS}` });
    }

    const filters = { role: 'employee', ...departmentFilter };

    const [birthdays, total, upcoming] = await Promise.all([
      getTodayCelebrations(DATE_FIELDS.birthday, filters, date, limit, skip),
      countTodayCelebrations(DATE_FIELDS.birthday, filters, date),
      includeUpcoming
        ? getUpcomingCelebrations(DATE_FIELDS.birthday, upcomingDays, filters, limit, skip)
        : Promise.resolve([]),
    ]);

    res.status(200).json({
      success: true,
      count: birthdays.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
      data: {
        today: birthdays,
        upcoming: upcoming.map((u) => enrichUpcoming(u, date, DATE_FIELDS.birthday)),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getTodaysMarriageAnniversaries = async (req, res, next) => {
  try {
    const date = parseDate(req.query);
    if (!date) return sendError(res, { message: 'Invalid date format. Use YYYY-MM-DD' });

    const { page, limit, skip } = parsePagination(req.query);
    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.query.department);
    if (error) return sendError(res, error);

    const includeUpcoming = req.query.includeUpcoming === 'true';
    const upcomingDays = includeUpcoming ? parseUpcomingDays(req.query) : DEFAULT_UPCOMING_DAYS;
    if (includeUpcoming && upcomingDays === null) {
      return sendError(res, { message: `Upcoming days must be between 1 and ${MAX_UPCOMING_DAYS}` });
    }

    const filters = { role: 'employee', maritalStatus: 'married', ...departmentFilter };

    const [anniversaries, total, upcoming] = await Promise.all([
      getTodayCelebrations(DATE_FIELDS.marriage, filters, date, limit, skip),
      countTodayCelebrations(DATE_FIELDS.marriage, filters, date),
      includeUpcoming
        ? getUpcomingCelebrations(DATE_FIELDS.marriage, upcomingDays, filters, limit, skip)
        : Promise.resolve([]),
    ]);

    res.status(200).json({
      success: true,
      count: anniversaries.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
      data: {
        today: anniversaries,
        upcoming: upcoming.map((u) => enrichUpcoming(u, date, DATE_FIELDS.marriage)),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getTodaysWorkAnniversaries = async (req, res, next) => {
  try {
    const date = parseDate(req.query);
    if (!date) return sendError(res, { message: 'Invalid date format. Use YYYY-MM-DD' });

    const { page, limit, skip } = parsePagination(req.query);
    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.query.department);
    if (error) return sendError(res, error);

    const includeUpcoming = req.query.includeUpcoming === 'true';
    const upcomingDays = includeUpcoming ? parseUpcomingDays(req.query) : DEFAULT_UPCOMING_DAYS;
    if (includeUpcoming && upcomingDays === null) {
      return sendError(res, { message: `Upcoming days must be between 1 and ${MAX_UPCOMING_DAYS}` });
    }

    const filters = { role: 'employee', ...departmentFilter };

    const [workAnniversaries, total, upcoming] = await Promise.all([
      getTodayCelebrations(DATE_FIELDS.work, filters, date, limit, skip),
      countTodayCelebrations(DATE_FIELDS.work, filters, date),
      includeUpcoming
        ? getUpcomingCelebrations(DATE_FIELDS.work, upcomingDays, filters, limit, skip)
        : Promise.resolve([]),
    ]);

    const withYears = workAnniversaries.map((u) => ({
      ...u,
      yearsOfService: date.diff(moment(u.dateOfJoining), 'years'),
    }));

    const upcomingWithYears = upcoming.map((u) => ({
      ...enrichUpcoming(u, date, DATE_FIELDS.work),
      yearsOfService: date.diff(moment(u.dateOfJoining), 'years'),
    }));

    res.status(200).json({
      success: true,
      count: withYears.length,
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
      data: {
        today: withYears,
        upcoming: upcomingWithYears,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getCelebrationStats = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || moment().year();
    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.query.department);
    if (error) return sendError(res, error);

    const stats = await withTimeout(
      User.aggregate([
        { $match: { isActive: true, role: 'employee', ...departmentFilter } },
        {
          $facet: {
            birthdays: [
              { $match: { dateOfBirth: { $exists: true, $ne: null } } },
              { $group: { _id: { $month: '$dateOfBirth' }, count: { $sum: 1 } } },
              { $project: { _id: 0, month: '$_id', count: 1 } },
              { $sort: { month: 1 } },
            ],
            marriageAnniversaries: [
              {
                $match: {
                  marriageAnniversary: { $exists: true, $ne: null },
                  maritalStatus: 'married',
                },
              },
              { $group: { _id: { $month: '$marriageAnniversary' }, count: { $sum: 1 } } },
              { $project: { _id: 0, month: '$_id', count: 1 } },
              { $sort: { month: 1 } },
            ],
            workAnniversaries: [
              { $match: { dateOfJoining: { $exists: true, $ne: null } } },
              { $group: { _id: { $month: '$dateOfJoining' }, count: { $sum: 1 } } },
              { $project: { _id: 0, month: '$_id', count: 1 } },
              { $sort: { month: 1 } },
            ],
          },
        },
      ])
    );

    res.status(200).json({
      success: true,
      data: {
        year,
        birthdays: stats[0]?.birthdays || [],
        marriageAnniversaries: stats[0]?.marriageAnniversaries || [],
        workAnniversaries: stats[0]?.workAnniversaries || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.sendCelebrationNotification = async (req, res, next) => {
  try {
    if (!['hr', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Not authorized to send notifications' });
    }

    const date = req.body.date ? moment(req.body.date, 'YYYY-MM-DD', true) : moment();
    if (req.body.date && !date.isValid()) {
      return sendError(res, { message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const { filter: departmentFilter, error } = await resolveDepartmentFilter(req.body.department);
    if (error) return sendError(res, error);

    const filters = { role: 'employee', ...departmentFilter };
    const marriageFilters = { role: 'employee', maritalStatus: 'married', ...departmentFilter };

    const [birthdays, marriageAnniversaries, workAnniversaries] = await Promise.all([
      getTodayCelebrations(DATE_FIELDS.birthday, filters, date, 100, 0),
      getTodayCelebrations(DATE_FIELDS.marriage, marriageFilters, date, 100, 0),
      getTodayCelebrations(DATE_FIELDS.work, filters, date, 100, 0),
    ]);

    const notifications = [];
    birthdays.forEach((u) =>
      notifications.push(`Sending birthday email to ${u.fullName || `${u.firstName} ${u.lastName}`} (${u.email})`)
    );
    marriageAnniversaries.forEach((u) =>
      notifications.push(`Sending marriage anniversary email to ${u.fullName || `${u.firstName} ${u.lastName}`} (${u.email})`)
    );
    workAnniversaries.forEach((u) => {
      const years = date.diff(moment(u.dateOfJoining), 'years');
      notifications.push(
        `Sending ${years}-year work anniversary email to ${u.fullName || `${u.firstName} ${u.lastName}`} (${u.email})`
      );
    });

    res.status(200).json({
      success: true,
      message: 'Notifications queued successfully',
      data: notifications,
    });
  } catch (err) {
    next(err);
  }
};

exports.getEmployeeDetails = async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    // ─── NEW: enforce "HR, superadmin, or self"
    if (!['hr', 'superadmin'].includes(req.user.role) && req.user.employeeId !== employeeId) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this employee' });
    }

    const employee = await User.findOne({ employeeId, isActive: true })
      .select(
        'employeeId firstName lastName fullName email department dateOfBirth marriageAnniversary dateOfJoining maritalStatus spouseDetails designation'
      )
      .populate({ path: 'department', select: 'name' })
      .lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: `Employee with ID ${employeeId} not found`,
      });
    }

    if (employee.dateOfJoining) {
      employee.yearsOfService = moment().diff(moment(employee.dateOfJoining), 'years');
    }

    res.status(200).json({ success: true, data: employee });
  } catch (err) {
    next(err);
  }
};

// ────────────────────────────────────────────────────────────────
// ─── NEW: PEER-TO-PEER REGARDS ─────────────────────────────────
// ────────────────────────────────────────────────────────────────

/**
 * POST /api/celebrations/:employeeId/regards
 * Access: any authenticated employee (self excluded).
 *
 * Body: { celebrationType, celebrationDate (YYYY-MM-DD), message }
 */
exports.sendRegards = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { celebrationType, celebrationDate, message } = req.body;

    // ── validate input ────────────────────────────────────────
    if (!['birthday', 'marriage', 'work'].includes(celebrationType)) {
      return sendError(res, { message: 'Invalid celebrationType' });
    }
    if (!message || !message.trim()) {
      return sendError(res, { message: 'Message is required' });
    }
    if (message.trim().length > 500) {
      return sendError(res, { message: 'Message must be 500 characters or fewer' });
    }
    const date = moment(celebrationDate, 'YYYY-MM-DD', true);
    if (!date.isValid()) {
      return sendError(res, { message: 'Invalid celebrationDate. Use YYYY-MM-DD' });
    }

    // ── resolve recipient ────────────────────────────────────
    const recipient = await User.findOne({ employeeId, isActive: true })
      .select('_id employeeId firstName lastName fullName email role designation department')
      .populate({ path: 'department', select: 'name' })
      .lean();
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'Recipient not found' });
    }
    if (recipient._id.toString() === req.user.id.toString()) {
      return sendError(res, { message: 'You cannot send regards to yourself' });
    }

    // ── verify celebration applies to this person ───────────
    const dateField = DATE_FIELDS[celebrationType];
    const record = await User.findById(recipient._id)
      .select(`${dateField} maritalStatus isActive role`)
      .lean();
    const raw = record?.[dateField];
    if (!raw) {
      return sendError(res, { message: 'This person has no such celebration date on file' });
    }
    if (celebrationType === 'marriage' && record.maritalStatus !== 'married') {
      return sendError(res, { message: 'Recipient is not marked as married' });
    }
    const orig = moment(raw);
    if (orig.month() !== date.month() || orig.date() !== date.date()) {
      return sendError(res, { message: 'Celebration date does not match the recipient record' });
    }

    // ── persist ─────────────────────────────────────────────
    let greeting;
    try {
      greeting = await CelebrationGreeting.create({
        from: req.user.id,
        to: recipient._id,
        celebrationType,
        celebrationDate: date.format('YYYY-MM-DD'),
        message: message.trim(),
      });
    } catch (err) {
      if (err.code === 11000) {
        return sendError(res, { message: 'You have already sent regards for this celebration' });
      }
      throw err;
    }

    // ── deliver ─────────────────────────────────────────────
    // Immediate mode: fire-and-forget (does not block the HTTP response).
    // Digest mode: leave 'pending'; a cron drains the queue via
    //              exports.sendPendingRegardsDigest().
    if (REGARDS_DELIVERY_MODE === 'immediate') {
      Promise.resolve()
        .then(async () => {
          const sender = await User.findById(req.user.id)
            .select('fullName firstName lastName email designation department')
            .populate({ path: 'department', select: 'name' })
            .lean();

          await emailService.sendRegardsEmail({
            sender,
            recipient,
            celebrationType,
            message: greeting.message,
            celebrationDate: greeting.celebrationDate,
          });

          await CelebrationGreeting.updateOne(
            { _id: greeting._id },
            { status: 'delivered' }
          );
        })
        .catch(async (e) => {
          console.error('Regard delivery failed:', e.message);
          await CelebrationGreeting.updateOne(
            { _id: greeting._id },
            { status: 'failed', deliveryError: e.message }
          ).catch(() => {});
        });
    }

    res.status(201).json({
      success: true,
      data: {
        id: greeting._id,
        to: recipient.employeeId,
        celebrationType,
        celebrationDate: greeting.celebrationDate,
        message: greeting.message,
        status: greeting.status,
        deliveryMode: REGARDS_DELIVERY_MODE,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/celebrations/regards/received
 * Regards sent TO the logged-in user.
 */
exports.getMyReceivedRegards = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { to: req.user.id, status: { $in: ['delivered', 'pending'] } };

    const [items, total] = await Promise.all([
      CelebrationGreeting.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'from',
          select: 'employeeId fullName firstName lastName designation department',
          populate: { path: 'department', select: 'name' },
        })
        .lean(),
      CelebrationGreeting.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      ...buildBucket(items, total, page, limit),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/celebrations/regards/sent
 * Regards sent BY the logged-in user.
 */
exports.getMySentRegards = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [items, total] = await Promise.all([
      CelebrationGreeting.find({ from: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'to',
          select: 'employeeId fullName firstName lastName designation department',
          populate: { path: 'department', select: 'name' },
        })
        .lean(),
      CelebrationGreeting.countDocuments({ from: req.user.id }),
    ]);

    res.status(200).json({
      success: true,
      ...buildBucket(items, total, page, limit),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/celebrations/regards/:id/read
 */
exports.markRegardRead = async (req, res, next) => {
  try {
    const greeting = await CelebrationGreeting.findOneAndUpdate(
      { _id: req.params.id, to: req.user.id },
      { readAt: new Date() },
      { new: true }
    ).lean();

    if (!greeting) {
      return res.status(404).json({ success: false, error: 'Regard not found' });
    }
    res.status(200).json({ success: true, data: greeting });
  } catch (err) {
    next(err);
  }
};

/**
 * Cron entrypoint for digest mode.
 * Call from a scheduled job (e.g. daily at 9am IST):
 *   const { sendPendingRegardsDigest } = require('../controllers/celebrationController');
 *   await sendPendingRegardsDigest();
 *
 * Groups all pending greetings by recipient and sends one email per recipient.
 */
exports.sendPendingRegardsDigest = async () => {
  // Pull pending greetings, grouped in memory. Small volumes; fine.
  const pending = await CelebrationGreeting.find({ status: 'pending' })
    .populate({
      path: 'from',
      select: 'fullName firstName lastName email designation department',
      populate: { path: 'department', select: 'name' },
    })
    .populate({ path: 'to', select: 'firstName lastName fullName email' })
    .lean();

  if (!pending.length) {
    return { recipients: 0, delivered: 0, failed: 0, greetingsDelivered: 0 };
  }

  const byRecipient = new Map();
  for (const g of pending) {
    if (!g.to?._id) continue;
    const key = g.to._id.toString();
    if (!byRecipient.has(key)) byRecipient.set(key, { recipient: g.to, greetings: [] });
    byRecipient.get(key).greetings.push(g);
  }

  let delivered = 0;
  let failed = 0;
  let greetingsDelivered = 0;

  for (const { recipient, greetings } of byRecipient.values()) {
    try {
      await emailService.sendRegardsDigestEmail(recipient, greetings);
      const ids = greetings.map((g) => g._id);
      await CelebrationGreeting.updateMany(
        { _id: { $in: ids } },
        { status: 'delivered' }
      );
      delivered += 1;
      greetingsDelivered += greetings.length;
    } catch (err) {
      console.error(`Digest to ${recipient.email} failed:`, err.message);
      const ids = greetings.map((g) => g._id);
      await CelebrationGreeting.updateMany(
        { _id: { $in: ids } },
        { status: 'failed', deliveryError: err.message }
      ).catch(() => {});
      failed += 1;
    }
  }

  return {
    recipients: byRecipient.size,
    delivered,
    failed,
    greetingsDelivered,
  };
};