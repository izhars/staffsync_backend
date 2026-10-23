// src/controllers/roleController.js
const ProjectRole = require('../models/ProjectRole');
const ProjectResponsibility = require('../models/ProjectResponsibility');
const Project = require('../models/Project');

// @desc    Create a new project role
// @route   POST /api/v1/project-roles
// @access  Private/Admin
exports.createRole = async (req, res, next) => {
  try {
    const { name, code, description, level, permissions, defaultResponsibilities } = req.body;

    const existingRole = await ProjectRole.findOne({ code });
    if (existingRole) {
      return res.status(400).json({ message: 'Role code already exists' });
    }

    const role = await ProjectRole.create({
      name,
      code,
      description,
      level,
      permissions: permissions || {},
      defaultResponsibilities,
      createdBy: req.user.id
    });

    res.status(201).json({
      message: 'Role created successfully',
      data: role
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all project roles
// @route   GET /api/v1/project-roles
// @access  Private
exports.getAllRoles = async (req, res, next) => {
  try {
    const { isActive = 'true', search } = req.query;

    let query = {};

    if (isActive !== 'all') {
      query.isActive = isActive === 'true';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const roles = await ProjectRole.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort('level');

    res.status(200).json({
      message: 'Roles fetched successfully',
      data: roles
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add responsibility to project
// @route   POST /api/v1/projects/:projectId/responsibilities
// @access  Private/Manager
exports.addResponsibility = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const {
      assignedTo,
      role,
      title,
      description,
      category,
      priority,
      kpis,
      startDate,
      endDate
    } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const isTeamMember = project.teamMembers.some(
      member => member.employee.toString() === assignedTo && member.isActive
    );

    if (!isTeamMember) {
      return res.status(400).json({
        message: 'Assigned employee is not a team member'
      });
    }

    const responsibility = await ProjectResponsibility.create({
      project: projectId,
      assignedTo,
      role,
      title,
      description,
      category,
      priority,
      kpis,
      startDate: startDate || new Date(),
      endDate,
      createdBy: req.user.id
    });

    await responsibility.populate('assignedTo', 'firstName lastName email');
    await responsibility.populate('role', 'name code');

    res.status(201).json({
      message: 'Responsibility added successfully',
      data: responsibility
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get project responsibilities
// @route   GET /api/v1/projects/:projectId/responsibilities
// @access  Private
exports.getProjectResponsibilities = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { assignedTo, status, priority, category, sort = '-createdAt' } = req.query;

    let query = { project: projectId };

    if (assignedTo) query.assignedTo = assignedTo;
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;

    const responsibilities = await ProjectResponsibility.find(query)
      .populate('assignedTo', 'firstName lastName email position')
      .populate('role', 'name code')
      .populate('createdBy', 'firstName lastName')
      .sort(sort);

    res.status(200).json({
      message: 'Responsibilities fetched successfully',
      data: responsibilities
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update responsibility progress
// @route   PATCH /api/v1/responsibilities/:id/progress
// @access  Private
exports.updateResponsibilityProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { progress, status, comment } = req.body;

    const responsibility = await ProjectResponsibility.findById(id);
    if (!responsibility) {
      return res.status(404).json({ message: 'Responsibility not found' });
    }

    if (
      responsibility.assignedTo.toString() !== req.user.id &&
      !req.user.isManager
    ) {
      return res.status(403).json({
        message: 'Not authorized to update this responsibility'
      });
    }

    if (progress !== undefined) {
      responsibility.progress = progress;
      if (progress === 100) {
        responsibility.status = 'completed';
        responsibility.endDate = new Date();
      }
    }

    if (status) {
      responsibility.status = status;
      if (status === 'completed') {
        responsibility.progress = 100;
      }
    }

    if (comment) {
      responsibility.comments.push({
        comment,
        commentedBy: req.user.id
      });
    }

    responsibility.updatedAt = Date.now();
    await responsibility.save();

    res.status(200).json({
      message: 'Responsibility updated successfully',
      data: responsibility
    });
  } catch (error) {
    next(error);
  }
};


// @desc    Update project role
// @route   PATCH /api/v1/project-roles/:id
// @access  Private/Admin
exports.updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const role = await ProjectRole.findById(id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    if (role.isSystemRole) {
      return res.status(403).json({
        message: 'System roles cannot be modified'
      });
    }

    // Prevent duplicate role code
    if (updates.code && updates.code !== role.code) {
      const existingCode = await ProjectRole.findOne({ code: updates.code });
      if (existingCode) {
        return res.status(400).json({
          message: 'Role code already exists'
        });
      }
    }

    Object.assign(role, updates);
    await role.save();

    res.status(200).json({
      message: 'Role updated successfully',
      data: role
    });
  } catch (error) {
    next(error);
  }
};


// @desc    Delete (deactivate) project role
// @route   DELETE /api/v1/project-roles/:id
// @access  Private/Admin
exports.deleteRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    const role = await ProjectRole.findById(id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    if (role.isSystemRole) {
      return res.status(403).json({
        message: 'System roles cannot be deleted'
      });
    }

    await ProjectRole.findByIdAndDelete(id);

    res.status(200).json({
      message: 'Role permanently deleted'
    });
  } catch (error) {
    next(error);
  }
};

