const express = require('express');
const router = express.Router();
const { 
    debugUserConnection, 
    getConnectionStats,
    getOnlineUsers,
    isUserOnline 
} = require('../socket/chat');

// Get all connection statistics
router.get('/connections', async (req, res) => {
    try {
        const stats = getConnectionStats();
        res.json({
            success: true,
            ...stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Debug specific user connection
router.get('/connections/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const debugInfo = debugUserConnection(userId);
        
        res.json({
            success: true,
            ...debugInfo
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all online users
router.get('/online-users', async (req, res) => {
    try {
        const onlineUsers = getOnlineUsers();
        
        res.json({
            success: true,
            count: onlineUsers.length,
            users: onlineUsers,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test if user is online
router.get('/online-status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const online = isUserOnline(userId);
        
        res.json({
            success: true,
            userId,
            isOnline: online,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/socket-status', (req, res) => {
  try {
    const { getIo, getOnlineUsers } = require('../socket/chat');
    const io = getIo();

    if (!io) {
      return res.json({
        success: false,
        message: 'Socket.IO not initialized',
        status: 'io_not_initialized',
      });
    }

    const onlineUsers = getOnlineUsers ? getOnlineUsers() : [];
    const sockets = io.sockets ? Array.from(io.sockets.sockets.keys()) : [];

    res.json({
      success: true,
      status: 'running',
      ioInitialized: true,
      connectedSockets: sockets.length,
      onlineUsersCount: onlineUsers.length,
      onlineUsers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/debug/test-connection
 */
router.get('/test-connection', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    socketEnabled: true,
  });
});

module.exports = router;