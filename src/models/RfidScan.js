// src/models/RfidScan.js
const mongoose = require('mongoose');

const rfidScanSchema = new mongoose.Schema(
  {
    epc: {
      type: String,
      required: true,
      index: true,
    },
    rssi: {
      type: String,
      required: true,
    },
    tid: {
      type: String,
      default: '',
    },
    count: {
      type: Number,
      required: true,
      min: 1,
    },
    total_reads: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      required: true,
    },
    lane_entry_id: {
      type: Number,
      index: true,
    },
    lane_name: {
      type: String,
    },
    reader_name: {
      type: String,
    },
    photos: [
      {
        url: String,
        publicId: String,
        bytes: Number,
        format: String,
        originalName: String,
        filename: String,
        path: String,
        size: Number,
        uploadDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    scanReceivedAt: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
rfidScanSchema.index({ epc: 1, timestamp: -1 });
rfidScanSchema.index({ lane_entry_id: 1, timestamp: -1 });
rfidScanSchema.index({ timestamp: -1 });

module.exports = mongoose.model('RfidScan', rfidScanSchema);