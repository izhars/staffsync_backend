const mongoose = require('mongoose');
const projectRoleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Role name is required'],
        unique: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    description: String,
    level: {
        type: Number,
        min: 1,
        max: 10,
        default: 5
    },
    permissions: {
        canCreateTasks: { type: Boolean, default: false },
        canAssignTasks: { type: Boolean, default: false },
        canApproveTasks: { type: Boolean, default: false },
        canViewBudget: { type: Boolean, default: false },
        canEditBudget: { type: Boolean, default: false },
        canManageTeam: { type: Boolean, default: false },
        canUploadDocuments: { type: Boolean, default: false },
        canEditProject: { type: Boolean, default: false }
    },
    defaultResponsibilities: [{
        title: String,
        description: String,
        category: String
    }],
    isSystemRole: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

projectRoleSchema.index({ code: 1 });
projectRoleSchema.index({ level: 1 });
projectRoleSchema.index({ isActive: 1 });

module.exports = mongoose.model('ProjectRole', projectRoleSchema);