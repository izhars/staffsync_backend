require('dotenv').config();

const http = require('http');
const createApp = require('./app');
const { initializeServices } = require('./startup');

const PORT = process.env.PORT || 5000;

// ── Validate required env vars early ─────────────
const REQUIRED_ENV = ['NODE_ENV'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`);
    process.exit(1);
  }
}

async function start() {
  const app = createApp();
  const server = http.createServer(app);

  try {
    await initializeServices(app, server);
  } catch (err) {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, () => {
      const url = `http://localhost:${PORT}`;
      console.log(`
┌─────────────────────────────────────────────┐
│  🚀 HRMS Server                             │
├─────────────────────────────────────────────┤
│  Env    : ${process.env.NODE_ENV || 'development'}
│  API    : ${url}/api
│  Socket : ${url}
│  Debug  : ${url}/api/debug/socket-status
└─────────────────────────────────────────────┘
`);
      resolve();
    });
  });

  return server;
}

// ── Graceful shutdown ────────────────────────────
function registerShutdownHandlers(server) {
  let shuttingDown = false;

  const shutdown = (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`🛑 ${signal} received. Shutting down gracefully...`);

    if (!server.listening) {
      console.log('✅ Process terminated');
      return process.exit(exitCode);
    }

    // Force exit if close hangs (keep-alive sockets, etc.)
    const forceExit = setTimeout(() => {
      console.error('⚠️  Forced shutdown after timeout');
      process.exit(exitCode || 1);
    }, 10_000);
    forceExit.unref();

    // Kill idle keep-alive connections (Node 18.2+)
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    server.close(() => {
      clearTimeout(forceExit);
      console.log('✅ Process terminated');
      process.exit(exitCode);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGQUIT', () => shutdown('SIGQUIT', 0));

  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    shutdown('unhandledRejection', 1);
  });

  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    shutdown('uncaughtException', 1);
  });
}

// ── Boot ─────────────────────────────────────────
start()
  .then(registerShutdownHandlers)
  .catch((err) => {
    console.error('❌ Fatal boot error:', err);
    process.exit(1);
  });