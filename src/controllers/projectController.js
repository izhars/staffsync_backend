const Project = require('../models/Project');
const ProjectRole = require('../models/ProjectRole');

// -------------------- CREATE PROJECT --------------------
exports.createProject = async (req, res, next) => {
  try {
    const { name, code, description, startDate, endDate, budget, tags, status } = req.body;

    console.log('✏️ [CREATE_PROJECT_API_HIT]');
    console.log('➡️ requestedBy:', req.user.id);
    console.log('➡️ body:', req.body);

    // -------------------- VALIDATIONS --------------------

    // Required fields
    if (!name || !code || !startDate || !endDate) {
      return res.status(400).json({ message: 'Name, code, startDate, and endDate are required' });
    }

    // Check code format (optional: only letters, numbers, dash)
    const codeRegex = /^[A-Z0-9-]+$/i;
    if (!codeRegex.test(code)) {
      return res.status(400).json({ message: 'Project code format is invalid' });
    }

    // Dates validation
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      return res.status(400).json({ message: 'End date cannot be earlier than start date' });
    }

    // Budget validation
    const allocatedBudget = budget ?? 0;
    if (allocatedBudget < 0) {
      return res.status(400).json({ message: 'Budget must be a positive number' });
    }

    // Status validation
    const allowedStatuses = ['planning', 'active', 'on-hold', 'completed', 'cancelled', 'in-progress'];
    const projectStatus = status ?? 'planning';
    if (!allowedStatuses.includes(projectStatus)) {
      return res.status(400).json({ message: 'Invalid project status' });
    }

    // Tags validation
    const cleanTags = Array.isArray(tags) ? tags.map(tag => tag.trim()).filter(tag => tag) : [];

    // Check if code already exists
    const existingProject = await Project.findOne({ code });
    if (existingProject) {
      return res.status(400).json({ message: 'Project code already exists' });
    }

    // -------------------- CREATE PROJECT --------------------
    const project = await Project.create({
      name,
      code,
      description,
      startDate: start,
      endDate: end,
      budget: { allocated: allocatedBudget },
      tags: cleanTags,
      status: projectStatus,
      manager: req.user.id,
      createdBy: req.user.id
    });

    // Add manager as team member
    const managerRoleId = await getManagerRoleId();
    if (managerRoleId) {
      project.teamMembers.push({
        employee: req.user.id,
        role: managerRoleId,
        allocation: 100,
        startDate: new Date(),
        isActive: true
      });
      await project.save();
    }

    console.log('💾 Project created successfully:', project._id.toString());

    res.status(201).json({ message: 'Project created successfully', data: project });
  } catch (error) {
    console.error('🔥 CREATE_PROJECT_ERROR', error);
    next(error);
  }
};

// -------------------- UPDATE PROJECT --------------------
exports.updateProject = async (req, res, next) => {
  try {
    console.log('✏️ [UPDATE_PROJECT_API_HIT]');
    console.log('➡️ projectId:', req.params.id);
    console.log('➡️ requestedBy:', req.user.id);
    console.log('➡️ body:', req.body);

    const updates = Object.keys(req.body);

    const allowedUpdates = ['name','description','startDate','endDate','status','budget','tags'];
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));
    console.log('➡️ updates keys:', updates);

    if (!isValidOperation) {
      console.log('❌ Invalid update fields detected');
      return res.status(400).json({ message: 'Invalid updates!' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      console.log('❌ Project not found');
      return res.status(404).json({ message: 'Project not found' });
    }

    console.log('✅ Project found:', project._id.toString());

    // Only manager or admin can update
    if (req.user.role === 'manager' && project.manager.toString() !== req.user.id) {
      console.log('🚫 Access denied for user:', req.user.id);
      return res.status(403).json({ message: 'Access denied' });
    }

    // -------------------- FIELD UPDATES & VALIDATIONS --------------------
    for (let update of updates) {
      if (update === 'budget' && req.body.budget?.allocated !== undefined) {
        const newBudget = req.body.budget.allocated;
        if (newBudget < 0) {
          return res.status(400).json({ message: 'Budget must be a positive number' });
        }
        console.log(`💰 Updating budget.allocated: ${project.budget.allocated} -> ${newBudget}`);
        project.budget.allocated = newBudget;
      } else if (update === 'status') {
        const allowedStatuses = ['planning', 'active', 'on-hold', 'completed', 'cancelled', 'in-progress'];
        if (!allowedStatuses.includes(req.body.status)) {
          return res.status(400).json({ message: 'Invalid project status' });
        }
        console.log(`📝 Updating status: ${project.status} -> ${req.body.status}`);
        project.status = req.body.status;
      } else if (update === 'startDate' || update === 'endDate') {
        const dateValue = new Date(req.body[update]);
        if (update === 'endDate' && dateValue < project.startDate) {
          return res.status(400).json({ message: 'End date cannot be earlier than start date' });
        }
        if (update === 'startDate' && project.endDate && dateValue > project.endDate) {
          return res.status(400).json({ message: 'Start date cannot be later than end date' });
        }
        console.log(`📝 Updating ${update}: ${project[update]} -> ${dateValue}`);
        project[update] = dateValue;
      } else if (update === 'tags') {
        const cleanTags = Array.isArray(req.body.tags)
          ? req.body.tags.map(tag => tag.trim()).filter(tag => tag)
          : [];
        console.log(`🏷️ Updating tags: ${project.tags} -> ${cleanTags}`);
        project.tags = cleanTags;
      } else {
        console.log(`📝 Updating ${update}: ${project[update]} -> ${req.body[update]}`);
        project[update] = req.body[update];
      }
    }

    project.updatedAt = Date.now();
    await project.save();

    console.log('💾 Project updated successfully');

    res.status(200).json({ message: 'Project updated successfully', data: project });
  } catch (error) {
    console.error('🔥 UPDATE_PROJECT_ERROR', error);
    next(error);
  }
};



// -------------------- GET ALL PROJECTS --------------------
exports.getAllProjects = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, search, sort = '-createdAt' } = req.query;

    const skip = (page - 1) * limit;
    const query = {};

    // Managers see only their projects
    if (req.user.role === 'manager') {
      query.manager = req.user.id;
    }

    if (status) query.status = status;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } }
      ];
    }

    let projects = await Project.find(query)
      .populate('manager', 'firstName lastName email')
      .populate('teamMembers.employee', 'firstName lastName position')
      .populate('teamMembers.role', 'name code')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // 🔥 YAHI MAIN FIX 🔥
    projects = projects.map(project => {
      project.teamMembers = project.teamMembers.filter(
        member => member.isActive === true
      );
      return project;
    });

    const total = await Project.countDocuments(query);

    res.status(200).json({
      message: 'Projects fetched successfully',
      data: {
        projects,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};


// -------------------- GET SINGLE PROJECT --------------------
exports.getProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('manager', 'firstName lastName email phone')
      .populate({
        path: 'teamMembers.employee',
        select: 'firstName lastName email position profileImage'
      })
      .populate('teamMembers.role', 'name code permissions')
      .populate('createdBy', 'firstName lastName');

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // 🔥 REMOVE INACTIVE TEAM MEMBERS 🔥
    project.teamMembers = project.teamMembers.filter(
      member => member.isActive === true
    );

    // Access control (same as before)
    if (
      req.user.role === 'manager' &&
      project.manager._id.toString() !== req.user.id &&
      !project.teamMembers.some(
        m => m.employee._id.toString() === req.user.id
      ) &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.status(200).json({
      message: 'Project fetched successfully',
      data: project
    });
  } catch (error) {
    next(error);
  }
};


// -------------------- DELETE PROJECT --------------------
exports.deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Only manager or admin can delete
    if (req.user.role === 'manager' && project.manager.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    project.status = 'cancelled';
    project.teamMembers.forEach(member => {
      member.isActive = false;
      member.endDate = new Date();
    });

    await project.save();

    res.status(200).json({ message: 'Project deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// -------------------- HELPER --------------------
async function getManagerRoleId() {
  const managerRole = await ProjectRole.findOne({ code: 'PROJECT_MANAGER' });
  return managerRole ? managerRole._id : null;
}


// -------------------- ADD EXPENSE --------------------
exports.addExpense = async (req, res, next) => {
  try {
    const { amount, remark, date } = req.body;
    const projectId = req.params.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Access control: only manager or admin
    if (req.user.role === 'manager' && project.manager.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const expenseEntry = {
      amount,
      remark: remark?.trim() || '',
      date: date ? new Date(date) : new Date(),
      recordedBy: req.user.id
    };

    project.expenses.push(expenseEntry);

    // Optional: if you keep budget.spent field, update it
    // project.budget.spent += amount;

    await project.save();

    // ---- LOGGING ----
    console.log(`💰 [EXPENSE_ADDED] Project: ${project.name} (${project._id})`);
    console.log(`   Amount: ${amount}, Remark: ${remark || 'N/A'}, By: ${req.user.name || req.user.id}`);
    console.log(`   Date: ${expenseEntry.date.toISOString()}`);
    // Optional: you could also write this to a separate collection like ExpenseLog if needed

    res.status(201).json({
      message: 'Expense recorded successfully',
      data: { expense: expenseEntry, projectId: project._id }
    });
  } catch (error) {
    next(error);
  }
};

// -------------------- GET EXPENSE HISTORY --------------------
exports.getExpenseHistory = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .select('expenses name code budget')
      .populate('expenses.recordedBy', 'firstName lastName email');

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Sort newest first (safe)
    const expenses = project.expenses.sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    const totalSpent = expenses.reduce(
      (sum, exp) => sum + exp.amount,
      0
    );

    res.status(200).json({
      message: 'Expense history fetched successfully',
      data: {
        project: {
          name: project.name,
          code: project.code,
        },
        totalSpent,
        allocated: project.budget?.allocated ?? 0,
        expenses,
      },
    });
  } catch (error) {
    next(error);
  }
};

// -------------------- GET USER EXPENSE HISTORY --------------------
exports.getMyExpenseHistory = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .select('expenses name code budget')
      .populate('expenses.recordedBy', 'firstName lastName email');

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // 🎯 Only this user's expenses
    const userExpenses = project.expenses
      .filter(exp => exp.recordedBy?._id.toString() === req.user._id.toString())
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalSpent = userExpenses.reduce(
      (sum, exp) => sum + exp.amount,
      0
    );

    res.status(200).json({
      message: 'User expense history fetched successfully',
      data: {
        project: {
          name: project.name,
          code: project.code,
        },
        totalSpent,
        allocated: project.budget?.allocated ?? 0,
        expenses: userExpenses,
      },
    });
  } catch (error) {
    next(error);
  }
};


// -------------------- CHECK IF USER IS MEMBER --------------------
exports.isUserInProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId).select('teamMembers manager');

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const isMember =
      project.manager.toString() === req.user.id ||
      project.teamMembers.some(
        m => m.isActive && m.employee.toString() === req.user.id
      );

    res.status(200).json({ isMember });
  } catch (error) {
    next(error);
  }
};
