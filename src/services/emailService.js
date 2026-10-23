// services/emailService.js
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const Handlebars = require('handlebars');
const moment = require('moment-timezone');

// =============================================
// CONFIG
// =============================================
const TEMPLATE_DIR = path.join(__dirname, '../email');
const PARTIALS_DIR = path.join(TEMPLATE_DIR, 'partials');
const EMAIL_TIMEZONE = 'Asia/Kolkata';

const DEFAULTS = {
  batchSize: 10,
  delay: 1000,
  maxRetries: 3,
  retryDelay: 2000,
};

// =============================================
// TRANSPORTER (singleton)
// =============================================
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
};

const getFromAddress = () =>
  process.env.EMAIL_FROM || `HRMS System <${process.env.EMAIL_USER}>`;

// Graceful shutdown
exports.closeTransporter = () => {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
};

// =============================================
// CUSTOM ERROR
// =============================================
class EmailError extends Error {
  constructor(message, code, originalError) {
    super(message);
    this.name = 'EmailError';
    this.code = code;
    this.originalError = originalError;
  }
}

exports.EmailError = EmailError;

// =============================================
// HEALTH CHECK
// =============================================
exports.verifyEmailConfig = async () => {
  try {
    await getTransporter().verify();
    return true;
  } catch (error) {
    console.error('❌ Email transporter verification failed:', error.message);
    throw new EmailError('Email service unavailable', 'VERIFY_FAILED', error);
  }
};

// =============================================
// CORE SEND
// =============================================
exports.sendEmail = async ({ to, subject, html, text, attachments = [], replyTo }) => {
  const recipients = Array.isArray(to) ? to : [to];

  if (!recipients.length || !recipients[0]) {
    throw new EmailError('No recipients provided', 'NO_RECIPIENTS');
  }

  try {
    const info = await getTransporter().sendMail({
      from: getFromAddress(),
      to: recipients,
      subject,
      text: text || '',
      html: html || '',
      attachments,
      ...(replyTo && { replyTo }),
    });

    return {
      success: true,
      messageId: info.messageId,
      rejectedEmails: info.rejected,
      acceptedEmails: info.accepted,
    };
  } catch (error) {
    console.error('❌ Email send error:', {
      to: recipients,
      subject: subject?.substring(0, 50),
      error: error.message,
    });

    const codeMap = {
      EAUTH: 'AUTH_FAILED',
      ECONNECTION: 'CONNECTION_FAILED',
      ETIMEDOUT: 'TIMEOUT',
    };

    throw new EmailError(
      error.code === 'EAUTH'
        ? 'Email authentication failed'
        : error.code === 'ECONNECTION'
          ? 'Email server connection failed'
          : `Failed to send email: ${error.message}`,
      codeMap[error.code] || 'SEND_FAILED',
      error
    );
  }
};

// =============================================
// TEMPLATE SYSTEM
// =============================================
const templateCache = new Map();
let partialsLoaded = false;
let partialsLoadPromise = null;

const registerPartials = async () => {
  if (partialsLoaded) return;
  if (partialsLoadPromise) return partialsLoadPromise;

  partialsLoadPromise = (async () => {
    try {
      const files = await fs.readdir(PARTIALS_DIR);
      const htmlFiles = files.filter((f) => f.endsWith('.html'));

      await Promise.all(
        htmlFiles.map(async (file) => {
          const partialName = path.basename(file, '.html');
          const content = await fs.readFile(path.join(PARTIALS_DIR, file), 'utf-8');
          Handlebars.registerPartial(partialName, content);
        })
      );

      partialsLoaded = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('⚠️ Failed to load partials:', error.message);
      }
    } finally {
      partialsLoadPromise = null;
    }
  })();

  return partialsLoadPromise;
};

Handlebars.registerHelper('formatDate', (date, format = 'DD MMM YYYY') => {
  if (!date) return '';
  return moment(date).tz(EMAIL_TIMEZONE).format(format);
});

Handlebars.registerHelper('uppercase', (str) => {
  if (str == null) return '';
  return String(str).toUpperCase();
});

Handlebars.registerHelper('lowercase', (str) => {
  if (str == null) return '';
  return String(str).toLowerCase();
});

Handlebars.registerHelper('year', () => new Date().getFullYear());
Handlebars.registerHelper('eq', (a, b) => a === b);

exports.loadTemplate = async (fileName, data = {}) => {
  try {
    await registerPartials();

    if (templateCache.has(fileName)) {
      return templateCache.get(fileName)(data);
    }

    const filePath = path.join(TEMPLATE_DIR, fileName);

    let templateSource;
    try {
      templateSource = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new EmailError(
        `Template "${fileName}" not found in ${TEMPLATE_DIR}`,
        'TEMPLATE_NOT_FOUND',
        err
      );
    }

    const compiled = Handlebars.compile(templateSource);
    templateCache.set(fileName, compiled);

    return compiled(data);
  } catch (error) {
    if (error instanceof EmailError) throw error;
    console.error('❌ Template load error:', { fileName, error: error.message });
    throw new EmailError(
      `Failed to load template "${fileName}": ${error.message}`,
      'TEMPLATE_ERROR',
      error
    );
  }
};

exports.clearTemplateCache = () => {
  templateCache.clear();
  partialsLoaded = false;
};

// =============================================
// BULK EMAIL WITH RETRY
// =============================================
const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sendWithRetry = async (payload, maxRetries, retryDelay) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await exports.sendEmail(payload);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await sleep(retryDelay);
      }
    }
  }
  throw lastError;
};

exports.sendBulkEmail = async (emails, subject, html, options = {}) => {
  const { batchSize, delay, maxRetries, retryDelay } = { ...DEFAULTS, ...options };

  if (!emails?.length) {
    return { total: 0, success: 0, failed: 0, failedEmails: [], percentage: '0.0' };
  }

  const batches = chunk(emails, batchSize);
  const failedEmails = [];
  let successCount = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const results = await Promise.all(
      batch.map(async (email) => {
        try {
          await sendWithRetry({ to: email, subject, html }, maxRetries, retryDelay);
          return { email, ok: true };
        } catch (error) {
          return { email, ok: false, error: error.message };
        }
      })
    );

    results.forEach((r) => {
      if (r.ok) successCount++;
      else failedEmails.push({ email: r.email, error: r.error });
    });

    if (i < batches.length - 1) await sleep(delay);
  }

  return {
    total: emails.length,
    success: successCount,
    failed: failedEmails.length,
    failedEmails,
    percentage: ((successCount / emails.length) * 100).toFixed(1),
  };
};

// =============================================
// PRE-BUILT EMAIL FUNCTIONS
// =============================================
const baseTemplateData = (extra = {}) => ({
  year: new Date().getFullYear(),
  ...extra,
});

exports.sendWelcomeEmail = async (user, tempPassword) => {
  const html = await exports.loadTemplate(
    'welcome.html',
    baseTemplateData({
      firstName: user.firstName,
      lastName: user.lastName,
      employeeId: user.employeeId,
      email: user.email,
      tempPassword,
      loginUrl: process.env.APP_URL || 'http://localhost:7000',
    })
  );

  return exports.sendEmail({
    to: user.email,
    subject: 'Welcome to HRMS 🎉 - Your Account is Ready!',
    html,
  });
};

exports.sendPasswordResetEmail = async (user, resetToken) => {
  const resetURL = `${process.env.APP_URL || 'http://localhost:7000'}/reset-password?token=${resetToken}`;

  const html = await exports.loadTemplate(
    'password-reset.html',
    baseTemplateData({
      firstName: user.firstName,
      resetURL,
      expireTime: '15 minutes',
    })
  );

  return exports.sendEmail({
    to: user.email,
    subject: '🔒 HRMS Password Reset Request',
    html,
  });
};

exports.sendAnnouncementEmail = async (recipients, announcement) => {
  const html = await exports.loadTemplate(
    'announcement.html',
    baseTemplateData({
      title: announcement.title,
      message: announcement.message,
      priority: announcement.priority || 'normal',
      author: announcement.author,
      date: announcement.date || new Date(),
    })
  );

  return exports.sendBulkEmail(recipients, announcement.title, html);
};

exports.sendLeaveApprovalEmail = async (leave, manager) => {
  const employeeName = `${leave.employee.firstName} ${leave.employee.lastName}`;

  const html = await exports.loadTemplate(
    'leave-approval.html',
    baseTemplateData({
      managerName: manager.firstName,
      employeeName,
      employeeId: leave.employee.employeeId || 'N/A',
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      totalDays: leave.totalDays,
      reason: leave.reason,
      restrictedHolidays: leave.restrictedHolidaysUsed || [],
      approvalUrl: `${process.env.APP_URL}/leaves/approve/${leave._id}`,
      rejectUrl: `${process.env.APP_URL}/leaves/reject/${leave._id}`,
    })
  );

  return exports.sendEmail({
    to: manager.email,
    subject: `Leave Request from ${employeeName}`,
    html,
  });
};

exports.sendLeaveApprovedEmail = async (leave, approver) => {
  const html = await exports.loadTemplate(
    'leave-approved.html',
    baseTemplateData({
      firstName: leave.employee.firstName,
      leaveType: leave.leaveType,
      fromDate: leave.startDate,
      toDate: leave.endDate,
      totalDays: leave.totalDays,
      approverName: `${approver.firstName} ${approver.lastName}`,
      approvedOn: new Date(),
    })
  );

  return exports.sendEmail({
    to: leave.employee.email,
    subject: `✅ Your ${leave.leaveType} leave was approved`,
    html,
  });
};

exports.sendLeaveRejectedEmail = async (leave, rejecter) => {
  const html = await exports.loadTemplate(
    'leave-rejection.html',
    baseTemplateData({
      firstName: leave.employee.firstName,
      leaveType: leave.leaveType,
      fromDate: leave.startDate,
      toDate: leave.endDate,
      reason: leave.rejectionReason || 'No reason provided',
      rejecterName: `${rejecter.firstName} ${rejecter.lastName}`,
    })
  );

  return exports.sendEmail({
    to: leave.employee.email,
    subject: `❌ Your ${leave.leaveType} leave was rejected`,
    html,
  });
};

exports.sendTestEmail = async (to) => {
  const html = await exports.loadTemplate(
    'test.html',
    baseTemplateData({ testDate: new Date() })
  );

  return exports.sendEmail({
    to,
    subject: '🧪 HRMS Email System Test',
    html,
  });
};

// ─── NEW ─────────────────────────────────────────────────────
// CELEBRATION REGARDS (peer-to-peer)
// ─────────────────────────────────────────────────────────────

const CELEBRATION_LABELS = {
  birthday: {
    subject: (from) => `🎂 ${from} sent you birthday wishes!`,
    heading: 'Happy Birthday! 🎂',
    blurb: 'sent you birthday wishes',
    label: 'Birthday',
    accent: '#ed8936',
  },
  marriage: {
    subject: (from) => `💍 ${from} sent you anniversary wishes!`,
    heading: 'Happy Anniversary! 💍',
    blurb: 'sent you anniversary wishes',
    label: 'Marriage Anniversary',
    accent: '#d53f8c',
  },
  work: {
    subject: (from) => `🎉 ${from} congratulated you on your work anniversary!`,
    heading: 'Happy Work Anniversary! 🎉',
    blurb: 'congratulated you on your work anniversary',
    label: 'Work Anniversary',
    accent: '#4299e1',
  },
};

exports.CELEBRATION_LABELS = CELEBRATION_LABELS;

const buildSenderDisplay = (sender) => {
  if (!sender) return { name: 'A colleague', designation: null, department: null };
  return {
    name:
      sender.fullName ||
      `${sender.firstName || ''} ${sender.lastName || ''}`.trim() ||
      'A colleague',
    designation: sender.designation || null,
    department: sender.department?.name || null,
  };
};

/**
 * Immediate send — one email per regard, fire on the send request.
 * Prefer sendRegardsDigestEmail() for busy recipients.
 */
exports.sendRegardsEmail = async ({
  sender,
  recipient,
  celebrationType,
  message,
  celebrationDate,
}) => {
  const meta = CELEBRATION_LABELS[celebrationType];
  if (!meta) {
    throw new EmailError(
      `Unknown celebrationType: ${celebrationType}`,
      'INVALID_CELEBRATION_TYPE'
    );
  }
  if (!recipient?.email) {
    throw new EmailError('Recipient has no email', 'NO_RECIPIENT_EMAIL');
  }

  const senderDisplay = buildSenderDisplay(sender);

  const html = await exports.loadTemplate(
    'regards.html',
    baseTemplateData({
      recipientFirstName: recipient.firstName || recipient.fullName || 'there',
      senderName: senderDisplay.name,
      senderDesignation: senderDisplay.designation,
      senderDepartment: senderDisplay.department,
      celebrationType,
      celebrationHeading: meta.heading,
      celebrationBlurb: meta.blurb,
      celebrationDate,
      message,
      appUrl: process.env.APP_URL || 'http://localhost:7000',
    })
  );

  return exports.sendEmail({
    to: recipient.email,
    subject: meta.subject(senderDisplay.name),
    html,
    text: `${senderDisplay.name} ${meta.blurb}: "${message}"`,
    ...(sender?.email && { replyTo: sender.email }),
  });
};

/**
 * Batched send — ONE email per recipient containing all of their regards.
 * Accepts greeting docs already populated with `from` (sender).
 *
 * @param {object} recipient  User doc (needs firstName/fullName/email)
 * @param {Array}  greetings  [{ celebrationType, message, celebrationDate, from: {…sender} }]
 */
exports.sendRegardsDigestEmail = async (recipient, greetings) => {
  if (!recipient?.email) {
    throw new EmailError('Recipient has no email', 'NO_RECIPIENT_EMAIL');
  }
  if (!Array.isArray(greetings) || greetings.length === 0) {
    throw new EmailError('No greetings to digest', 'NO_GREETINGS');
  }

  const items = greetings.map((g) => {
    const meta = CELEBRATION_LABELS[g.celebrationType] || {};
    const senderDisplay = buildSenderDisplay(g.from);
    return {
      senderName: senderDisplay.name,
      senderDesignation: senderDisplay.designation,
      celebrationLabel: meta.label || 'Celebration',
      accent: meta.accent || '#4299e1',
      message: g.message,
    };
  });

  const html = await exports.loadTemplate(
    'regards-digest.html',
    baseTemplateData({
      recipientFirstName: recipient.firstName || recipient.fullName || 'there',
      count: items.length,
      items,
      appUrl: process.env.APP_URL || 'http://localhost:7000',
    })
  );

  const subject =
    items.length === 1
      ? CELEBRATION_LABELS[greetings[0].celebrationType]?.subject(items[0].senderName) ||
        'You received a regard!'
      : `🎉 You received ${items.length} regards today!`;

  return exports.sendEmail({
    to: recipient.email,
    subject,
    html,
    text: items.map((i) => `${i.senderName} ${i.celebrationLabel}: "${i.message}"`).join('\n'),
  });
};
// ─── END NEW ─────────────────────────────────────────────────

// =============================================
// ATTACHMENT HELPER
// =============================================
exports.createAttachment = (filePath, options = {}) => ({
  filename: options.filename || path.basename(filePath),
  path: filePath,
  contentType: options.contentType || 'application/pdf',
  ...(options.cid && { cid: options.cid }),
});

// =============================================
// STATS
// =============================================
exports.getEmailStats = async () => {
  try {
    const isVerified = await getTransporter().verify();
    return {
      isConnected: isVerified,
      cachedTemplates: templateCache.size,
      partialsLoaded,
      emailHost: process.env.EMAIL_HOST,
      emailUser: process.env.EMAIL_USER,
    };
  } catch (error) {
    return {
      isConnected: false,
      error: error.message,
      cachedTemplates: templateCache.size,
      partialsLoaded,
    };
  }
};