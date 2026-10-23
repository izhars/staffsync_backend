// src/startup.js
const connectDB = require('./config/db');
const cronJobs = require('./utils/cronJobs');
const emailService = require('./services/emailService');
const createSuperAdmin = require('../seedAdmin');
const { initSocket } = require('./socket');
const admin = require('../src/firebase/firebase');

async function initializeServices(app, server) {
  // 1. Database (fatal if fails)
  await connectDB();
  console.log('✅ MongoDB connected');

  // 1b. Presence is process-local: socket state died with the previous
  //     process, so any user still flagged online is stale and would wrongly
  //     suppress their push notifications.
  try {
    const User = require('./models/User');
    const { modifiedCount } = await User.updateMany(
      { isOnline: true },
      { $set: { isOnline: false, socketIds: [] } }
    );
    if (modifiedCount > 0) {
      console.log(`✅ Reset stale presence for ${modifiedCount} user(s)`);
    }
  } catch (err) {
    console.warn('⚠️  Presence reset failed:', err.message);
  }

  // 2. Cron jobs (fatal if fails)
  await cronJobs.startCronJobs();
  console.log('✅ Cron jobs started');

  // 3. Super admin (fatal if fails)
  await createSuperAdmin();
  console.log('✅ Super admin ready');

  // 4. Email service (optional)
  try {
    await emailService.verifyEmailConfig();
    console.log('✅ Email service ready');
  } catch (error) {
    console.warn('⚠️  Email service not configured:', error.message);
  }

  // 5. Socket.IO (fatal if fails)
  const io = initSocket(server);
  app.set('io', io); // so controllers can emit via req.io
  console.log('✅ Socket.IO ready');

  // 6. Firebase (optional)
  try {
    const bucket = admin.storage().bucket();
    console.log(`✅ Firebase bucket: ${bucket.name}`);
  } catch (err) {
    console.warn('⚠️  Firebase not configured:', err.message);
  }
}

module.exports = { initializeServices };