// middleware/errorHandler.js
const AppError = require('../utils/appError');

// ─────────────────────────────────────────────
// Mongoose: Invalid ObjectId
// ─────────────────────────────────────────────
const handleCastErrorDB = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400, {
    code: 'INVALID_ID',
  });

// ─────────────────────────────────────────────
// Mongoose: Duplicate key
// ─────────────────────────────────────────────
const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue || {})[0] || 'field';

  return new AppError(`Duplicate value for ${field}`, 409, {
    code: 'DUPLICATE_KEY',
    details: err.keyValue,
  });
};

// ─────────────────────────────────────────────
// Mongoose: Validation error
// ─────────────────────────────────────────────
const handleValidationErrorDB = (err) => {
  const details = Object.fromEntries(
    Object.entries(err.errors || {}).map(([key, value]) => [
      key,
      value.message,
    ])
  );

  return new AppError('Validation failed', 422, {
    code: 'VALIDATION_ERROR',
    details,
  });
};

// ─────────────────────────────────────────────
// JWT: Invalid token
// ─────────────────────────────────────────────
const handleJWTError = () =>
  new AppError('Invalid authentication token', 401, {
    code: 'INVALID_TOKEN',
  });

// ─────────────────────────────────────────────
// JWT: Token expired
// ─────────────────────────────────────────────
const handleJWTExpiredError = () =>
  new AppError('Authentication token expired', 401, {
    code: 'TOKEN_EXPIRED',
  });

// ─────────────────────────────────────────────
// JWT: Token not active yet
// ─────────────────────────────────────────────
const handleJWTNotBeforeError = () =>
  new AppError('Authentication token is not active yet', 401, {
    code: 'TOKEN_NOT_ACTIVE',
  });

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
const errorHandler = (err, req, res, next) => {
  let error = err;

  // ── Normalize known errors ──────────────────

  if (err.name === 'CastError') {
    error = handleCastErrorDB(err);
  } else if (err.code === 11000) {
    error = handleDuplicateFieldsDB(err);
  } else if (err.name === 'ValidationError') {
    error = handleValidationErrorDB(err);
  } else if (err.name === 'JsonWebTokenError') {
    error = handleJWTError();
  } else if (err.name === 'TokenExpiredError') {
    error = handleJWTExpiredError();
  } else if (err.name === 'NotBeforeError') {
    error = handleJWTNotBeforeError();
  }

  const statusCode = error.statusCode || 500;

  // ── Operational errors ──────────────────────
  const isOperational = error.isOperational === true;

  // ── Log unexpected errors ───────────────────
  if (!isOperational || statusCode >= 500) {
    console.error('🔥 [Unhandled Error]', err);
  }

  // ── Response ────────────────────────────────
  const payload = {
    success: false,
    status: error.status || (statusCode >= 500 ? 'error' : 'fail'),
    message:
      isOperational || process.env.NODE_ENV === 'development'
        ? error.message
        : 'Internal server error',
  };

  if (error.code) {
    payload.code = error.code;
  }

  if (error.details) {
    payload.details = error.details;
  }

  if (process.env.NODE_ENV === 'development') {
    payload.stack = error.stack;
  }

  return res.status(statusCode).json(payload);
};

module.exports = errorHandler;