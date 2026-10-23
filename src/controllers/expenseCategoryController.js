// controllers/expenseCategoryController.js
const Category = require('../models/ExpenseCategory');
const AppError = require('../utils/appError');

exports.createCategory = async (req, res, next) => {
  try {
    const { name, description, maxAmount, requiresApproval } = req.body;

    const exists = await Category.findOne({ name });
    if (exists) throw new AppError('Category already exists', 400);

    const category = await Category.create({ name, description, maxAmount, requiresApproval });

    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

exports.getCategories = async (req, res, next) => {
  try {
    const { search, requiresApproval, page = 1, limit = 10 } = req.query;
    const query = { isActive: true };

    if (search) query.name = { $regex: search, $options: 'i' };
    if (requiresApproval) query.requiresApproval = requiresApproval === 'true';

    const categories = await Category.find(query)
      .sort('name')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Category.countDocuments(query);

    res.json({ success: true, count: categories.length, total, data: categories });
  } catch (err) {
    next(err);
  }
};

exports.getCategoryById = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) throw new AppError('Category not found', 404);

    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const updates = req.body;

    const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!category) throw new AppError('Category not found', 404);

    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

exports.deactivateCategory = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!category) throw new AppError('Category not found', 404);

    res.json({ success: true, message: 'Category deactivated', data: category });
  } catch (err) {
    next(err);
  }
};
