// utils/AppError.js
class AppError extends Error {
  constructor(message, statusCode = 500, options = {}) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.status = String(statusCode).startsWith('4') ? 'fail' : 'error';
    this.isOperational = options.isOperational ?? true;

    // Optional error code (e.g. 'AUTH_EXPIRED')
    this.code = options.code || null;

    // Optional additional details
    this.details = options.details || null;

    // Capture proper stack trace (excludes constructor frame)
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;