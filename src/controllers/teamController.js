// src/controllers/teamController.js
const Project = require('../models/Project');
const ProjectResponsibility = require('../models/ProjectResponsibility');

// @desc    Add team member to project
// @route   POST /api/v1/projects/:projectId/team-members
// @access  Private/Manager
exports.addTeamMember = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { employee, role, allocation, responsibilities, startDate } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const existingMember = project.teamMembers.find(
      member => member.employee.toString() === employee && member.isActive
    );

    if (existingMember) {
      return res.status(400).json({
        message: 'Employee is already a team member'
      });
    }

    project.teamMembers.push({
      employee,
      role,
      allocation: allocation || 100,
      startDate: startDate || new Date(),
      isActive: true
    });

    if (responsibilities && responsibilities.length > 0) {
      const responsibilityDocs = responsibilities.map(resp => ({
        project: projectId,
        assignedTo: employee,
        role,
        title: resp.title,
        description: resp.description,
        category: resp.category || 'technical',
        priority: resp.priority || 'medium',
        createdBy: req.user.id
      }));

      await ProjectResponsibility.insertMany(responsibilityDocs);
    }

    await project.save();

    await project.populate('teamMembers.employee', 'firstName lastName email position');
    await project.populate('teamMembers.role', 'name code');

    res.status(200).json({
      message: 'Team member added successfully',
      data: project.teamMembers
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update team member allocation/role
// @route   PUT /api/v1/projects/:projectId/team-members/:memberId
// @access  Private/Manager
exports.updateTeamMember = async (req, res, next) => {
  try {
    const { projectId, memberId } = req.params;
    const { allocation, role, endDate, isActive } = req.body;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const teamMember = project.teamMembers.id(memberId);
    if (!teamMember) {
      return res.status(404).json({ message: 'Team member not found' });
    }

    if (allocation !== undefined) teamMember.allocation = allocation;
    if (role) teamMember.role = role;
    if (endDate) teamMember.endDate = endDate;

    if (isActive !== undefined) {
      teamMember.isActive = isActive;
      if (!isActive && !teamMember.endDate) {
        teamMember.endDate = new Date();
      }
    }

    teamMember.updatedAt = Date.now();
    await project.save();

    res.status(200).json({
      message: 'Team member updated successfully',
      data: teamMember
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove team member from project
// @route   DELETE /api/v1/projects/:projectId/team-members/:memberId
// @access  Private/Manager
exports.removeTeamMember = async (req, res, next) => {
  try {
    const { projectId, memberId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const teamMember = project.teamMembers.id(memberId);
    if (!teamMember) {
      return res.status(404).json({ message: 'Team member not found' });
    }

    if (
      req.user.role === 'manager' &&
      teamMember.employee.toString() === req.user.id
    ) {
      return res.status(400).json({
        message:
          'Project manager cannot remove himself. Delete the project instead.',
      });
    }

    // Soft remove
    teamMember.isActive = false;
    teamMember.endDate = new Date();

    // Put active responsibilities on hold
    const updateResult = await ProjectResponsibility.updateMany(
      {
        project: projectId,
        assignedTo: teamMember.employee,
        status: { $in: ['pending', 'in-progress'] },
      },
      {
        status: 'on-hold',
        $push: {
          comments: {
            comment:
              'Responsibility put on hold as team member was removed from project',
            commentedBy: req.user.id,
          },
        },
      }
    );

    await project.save();
    res.status(200).json({ message: 'Team member removed successfully' });
  } catch (error) {
    console.error('🔥 REMOVE_TEAM_MEMBER_ERROR', error);
    next(error);
  }
};



// @desc    Get project team members
// @route   GET /api/v1/projects/:projectId/team-members
// @access  Private
exports.getTeamMembers = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const { activeOnly = 'true' } = req.query;

    const project = await Project.findById(projectId)
      .populate({
        path: 'teamMembers.employee',
        select: 'firstName lastName email position department employeeId',
        populate: {
          path: 'department',
          select: 'name'
        }
      })
      .populate('teamMembers.role', 'name code level permissions')
      .select('teamMembers');

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    let teamMembers = project.teamMembers;

    if (activeOnly === 'true') {
      teamMembers = teamMembers.filter(member => member.isActive);
    }

    const teamMembersWithResponsibilities = await Promise.all(
      teamMembers.map(async member => {
        const responsibilities = await ProjectResponsibility.find({
          project: projectId,
          assignedTo: member.employee._id,
          status: { $ne: 'completed' }
        }).select('title description status progress priority');

        return {
          ...member.toObject(),
          responsibilities
        };
      })
    );

    res.status(200).json({
      message: 'Team members fetched successfully',
      data: teamMembersWithResponsibilities
    });
  } catch (error) {
    next(error);
  }
};
