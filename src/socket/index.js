// socket.js (updated)
const { Server } = require('socket.io');
const { initChat } = require('./chat');
const { initCallSocket } = require('./webrtc');
const { initNotificationSocket } = require('./notification'); // <-- new

let io = null;

function initSocket(httpServer) {
  if (io) {
    console.log('Socket.IO already initialized');
    return io;
  }

  if (!httpServer) {
    throw new Error('httpServer instance is required to initialize Socket.IO');
  }

  console.log('🚀 Initializing Socket.IO server...');

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }
        const allowedOrigins = [
          process.env.CLIENT_URL,
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001',
        ].filter(Boolean);
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        console.log('❌ CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 1e8,
    allowEIO3: true,
  });

  console.log('✅ Socket.IO server initialized');

  try {
    // Feature handlers
    initChat(io);
    console.log('✅ Chat socket handler initialized');

    const callNamespace = initCallSocket(io);
    console.log('✅ Call socket handler initialized on namespace:', callNamespace.name);

    // 👇 NEW: notification namespace
    initNotificationSocket(io);
    console.log('✅ Notification socket handler initialized on /notifications');

    io.engine.on('connection', (rawSocket) => {
      console.log('🔌 Raw engine connection:', rawSocket.id);
    });

    io.on('connection_error', (err) => {
      console.error('💥 Connection error:', err);
    });
  } catch (error) {
    console.error('❌ Failed to initialize socket handlers:', error);
    throw error;
  }

  io.use((socket, next) => {
    console.log('🌐 Global middleware for socket:', socket.id, 'namespace:', socket.nsp.name);
    next();
  });

  return io;
}

function getIo() {
  if (!io) {
    throw new Error(
      'Socket.IO not initialized yet. ' +
      'You must call initSocket(httpServer) first (usually in your server.js/app.js)'
    );
  }
  return io;
}

module.exports = {
  initSocket,
  getIo,
  getCallNamespace: () => io?.of('/call'),
  getNotificationNamespace: () => io?.of('/notifications'), // <-- new helper
};