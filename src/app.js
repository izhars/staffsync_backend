// src/app.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { corsOptions } = require('./config/cors');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const { registerRoutes } = require('./routes');
const AppError = require('./utils/appError');

function createApp() {
  const app = express();

  // Trust proxy (needed if behind nginx/heroku for req.ip, secure cookies)
  app.set('trust proxy', 1);

  // ── Security ──────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'form-action': ["'self'"],
          // Prefer nonce/hash over 'unsafe-inline'
        },
      },
    })
  );
  app.use(cors(corsOptions));

  // ── Body parsers ──────────────────────────────
  app.use(express.json({ limit: '1mb' }));       // tighten unless you truly need 50mb
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Static files (before logger so assets aren't logged) ──
  app.use(express.static(path.join(__dirname, 'public')));
  // Consider gating /uploads behind auth
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // Explicit page routes before generic static (already OK, but keep here)
  app.get('/reset-password/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'email', 'reset-password.html'));
  });

  // ── Logging (app routes only) ─────────────────
  app.use(requestLogger);

  // ── Socket.IO access for controllers ──────────
  // `startup.js` does `app.set('io', io)`, but controllers read `req.io`.
  // Without this bridge every HTTP-triggered socket emit is a silent no-op
  // (force-logout, notification:read/deleted, etc.).
  app.use((req, res, next) => {
    if (!req.io) req.io = app.get('io') || null;
    next();
  });

  // ── Health check BEFORE api routers ───────────
  app.get('/api/test-connection', (req, res) => {
    res.json({
      success: true,
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      socketEnabled: true,
    });
  });

  // ── API routes ────────────────────────────────
  registerRoutes(app);

  // ── 404 (forward to errorHandler) ─────────────
  app.all('*', (req, res, next) => {
    next(new AppError(`Route ${req.originalUrl} not found`, 404, {
      code: 'ROUTE_NOT_FOUND',
    }));
  });

  // ── Global error handler (must be last) ───────
  app.use(errorHandler);

  return app;
}

module.exports = createApp;