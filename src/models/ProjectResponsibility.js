const mongoose = require('mongoose');
const projectResponsibilitySchema = new mongoose.Schema({
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    role: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProjectRole',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['technical', 'managerial', 'administrative', 'quality', 'documentation'],
        default: 'technical'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    kpis: [{
        metric: String,
        target: String,
        unit: String
    }],
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: Date,
    status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'on-hold'],
        default: 'pending'
    },
    progress: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    comments: [{
        comment: String,
        commentedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
        commentedAt: { type: Date, default: Date.now }
    }],
    attachments: [{
        name: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now }
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    }
}, {
    timestamps: true
});

projectResponsibilitySchema.index({ project: 1, assignedTo: 1 });
projectResponsibilitySchema.index({ status: 1 });
projectResponsibilitySchema.index({ priority: 1 });
projectResponsibilitySchema.index({ category: 1 });

module.exports = mongoose.model('ProjectResponsibility', projectResponsibilitySchema);