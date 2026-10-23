const mongoose = require('mongoose');

const cronLogSchema = new mongoose.Schema({
  jobName: { type: String, required: true },
  lastRun: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('CronLog', cronLogSchema);
