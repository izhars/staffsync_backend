// controllers/departmentController.js
const Department = require('../models/Department');
const User = require('../models/User');
const AppError = require('../utils/appError');

// @desc    Get all departments
// @route   GET /api/departments
// @access  Private
exports.getAllDepartments = async (req, res, next) => {
  try {
    const { isActive } = req.query;

    const query = {
      isActive: isActive === undefined ? true : isActive === 'true',
    };

    const departments = await Department.find(query)
      .populate('head', 'firstName lastName email employeeId designation role')
      .sort({ name: 1 });

    const departmentsWithCount = await Promise.all(
      departments.map(async (dept) => {
        const employeeCount = await User.countDocuments({ department: dept._id });
        return { ...dept.toObject(), employeeCount };
      })
    );

    res.status(200).json({
      success: true,
      count: departmentsWithCount.length,
      departments: departmentsWithCount,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single department
// @route   GET /api/departments/:id
// @access  Private
exports.getDepartment = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id).populate(
      'head',
      'firstName lastName email employeeId profilePicture designation role'
    );

    if (!department) {
      throw new AppError('Department not found', 404, {
        code: 'DEPARTMENT_NOT_FOUND',
        details: { id: req.params.id },
      });
    }

    const employees = await User.find({
      department: req.params.id,
      isActive: true,
    }).select('firstName lastName employeeId email profilePicture designation role');

    res.status(200).json({ success: true, department, employees });
  } catch (error) {
    next(error);
  }
};

// @desc    Create department
// @route   POST /api/departments
// @access  Private (HR Admin, Superadmin)
exports.createDepartment = async (req, res, next) => {
  try {
    const { name, code, description, head } = req.body;

    const existingDept = await Department.findOne({
      $or: [{ name }, { code }],
    });

    if (existingDept) {
      throw new AppError('Department name or code already exists', 409, {
        code: 'DEPARTMENT_ALREADY_EXISTS',
        details: {
          name: existingDept.name === name ? name : undefined,
          code: existingDept.code === code ? code : undefined,
        },
      });
    }

    const payload = { name, code, description };
    if (head) payload.head = head;

    const department = await Department.create(payload);
    await department.populate('head', 'firstName lastName email designation role');

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      department,
    });
  } catch (error) {
    next(error); // Mongoose ValidationError/duplicate handled globally
  }
};

// @desc    Update department
// @route   PUT /api/departments/:id
// @access  Private (HR Admin, Superadmin)
exports.updateDepartment = async (req, res, next) => {
  try {
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('head', 'firstName lastName email designation role');

    if (!department) {
      throw new AppError('Department not found', 404, {
        code: 'DEPARTMENT_NOT_FOUND',
        details: { id: req.params.id },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Department updated successfully',
      department,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete department
// @route   DELETE /api/departments/:id
// @access  Private (Superadmin only)
exports.deleteDepartment = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      throw new AppError('Department not found', 404, {
        code: 'DEPARTMENT_NOT_FOUND',
        details: { id: req.params.id },
      });
    }

    const employeeCount = await User.countDocuments({
      department: req.params.id,
    });

    if (employeeCount > 0) {
      throw new AppError(
        `Cannot delete department. There are ${employeeCount} user(s) assigned to this department.`,
        409,
        {
          code: 'DEPARTMENT_HAS_EMPLOYEES',
          details: { employeeCount },
        }
      );
    }

    await Department.deleteOne({ _id: req.params.id });

    res.status(200).json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle department active status
// @route   PATCH /api/departments/:id/toggle-status
// @access  Private (HR Admin, Superadmin)
exports.toggleDepartmentStatus = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      throw new AppError('Department not found', 404, {
        code: 'DEPARTMENT_NOT_FOUND',
        details: { id: req.params.id },
      });
    }

    if (!department.isActive) {
      department.isActive = true;
    } else {
      const employeeCount = await User.countDocuments({
        department: req.params.id,
        isActive: true,
      });

      if (employeeCount > 0) {
        throw new AppError(
          `Cannot deactivate department with ${employeeCount} active employees`,
          409,
          {
            code: 'DEPARTMENT_HAS_ACTIVE_EMPLOYEES',
            details: { employeeCount },
          }
        );
      }

      department.isActive = false;
    }

    await department.save();

    res.status(200).json({
      success: true,
      message: `Department ${department.isActive ? 'activated' : 'deactivated'}`,
      department,
    });
  } catch (error) {
    next(error);
  }
};