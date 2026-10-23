// models/FaceRecognitionLog.js
const mongoose = require('mongoose');

const FaceRecognitionLogSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['registration', 'verification', 'check-in', 'check-out', 'update', 'deletion'],
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    success: {
        type: Boolean,
        required: true
    },
    confidence: {
        type: Number,
        min: 0,
        max: 1
    },
    method: {
        type: String,
        enum: ['face-api', 'aws-rekognition', 'azure-face', 'google-vision', 'custom-ml'],
        default: 'face-api'
    },
    error: {
        type: String
    },
    details: {
        type: String
    },
    deviceInfo: {
        type: mongoose.Schema.Types.Mixed
    },
    ipAddress: {
        type: String
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('FaceRecognitionLog', FaceRecognitionLogSchema);