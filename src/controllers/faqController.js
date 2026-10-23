// controllers/faqController.js
const FAQCategory = require('../models/FaqCategory');
const FAQ = require('../models/Faq');
const AppError = require('../utils/appError');
const {
  createCategorySchema,
  updateCategorySchema,
  createFaqSchema,
  updateFaqSchema,
} = require('../validators/faqValidator');

// ---------- Helper: Pagination ----------
const paginate = async (Model, query, options = {}) => {
  const page = Math.max(1, parseInt(options.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit) || 20));
  const skip = (page - 1) * limit;

  const total = await Model.countDocuments(query);
  const docs = await Model.find(query)
    .sort(options.sort || { order: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return {
    data: docs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// ---------- CATEGORY CRUD ----------
exports.getAllCategories = async (req, res, next) => {
  try {
    const categories = await FAQCategory.find().sort({ order: 1 });

    const populated = await Promise.all(
      categories.map(async (cat) => {
        const faqs = await FAQ.find({ category: cat._id, isActive: true })
          .sort({ order: 1 })
          .select('question answer tags order language _id');

        return {
          _id: cat._id,
          name: cat.name,
          description: cat.description,
          order: cat.order,
          faqs,
          createdAt: cat.createdAt,
        };
      })
    );

    // 🔥 Only keep categories that actually have FAQs
    const filtered = populated.filter(cat => cat.faqs.length > 0);

    res.json(filtered);
  } catch (err) {
    next(err);
  }
};


exports.getCategoryList = async (req, res, next) => {
  try {
    const categories = await FAQCategory.find()
      .sort({ order: 1 })
      .select('_id name description order createdAt');

    res.json(categories);
  } catch (err) {
    next(err);
  }
};


exports.addCategory = async (req, res, next) => {
  try {
    const { error, value } = createCategorySchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    const existing = await FAQCategory.findOne({ name: value.name });
    if (existing) return next(new AppError('Category already exists', 409));

    const category = await FAQCategory.create(value);
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const { error, value } = updateCategorySchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    if (value.name) {
      const exists = await FAQCategory.findOne({
        name: value.name,
        _id: { $ne: categoryId },
      });
      if (exists) return next(new AppError('Category name already taken', 409));
    }

    const category = await FAQCategory.findByIdAndUpdate(categoryId, value, {
      new: true,
      runValidators: true,
    });

    if (!category) return next(new AppError('Category not found', 404));

    res.json(category);
  } catch (err) {
    next(err);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;

    const category = await FAQCategory.findById(categoryId);
    if (!category) return next(new AppError('Category not found', 404));

    // Soft-delete FAQs or hard-delete?
    await FAQ.deleteMany({ category: categoryId }); // or set isActive = false
    await FAQCategory.findByIdAndDelete(categoryId);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// ---------- FAQ CRUD ----------
exports.addFaqToCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const { error, value } = createFaqSchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    const category = await FAQCategory.findById(categoryId);
    if (!category) return next(new AppError('Category not found', 404));

    const faq = await FAQ.create({ ...value, category: categoryId });
    res.status(201).json(faq);
  } catch (err) {
    next(err);
  }
};

exports.updateFaq = async (req, res, next) => {
  try {
    const { faqId } = req.params;
    const { error, value } = updateFaqSchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    const faq = await FAQ.findByIdAndUpdate(faqId, value, {
      new: true,
      runValidators: true,
    });

    if (!faq) return next(new AppError('FAQ not found', 404));

    res.json(faq);
  } catch (err) {
    next(err);
  }
};

exports.deleteFaq = async (req, res, next) => {
  try {
    const { faqId } = req.params;

    const faq = await FAQ.findByIdAndUpdate(
      faqId,
      { isActive: false },
      { new: true }
    );

    if (!faq) return next(new AppError('FAQ not found', 404));

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// ---------- REORDER FAQs ----------
exports.reorderFaqs = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const { order } = req.body; // Expect: [{ faqId: "...", order: 10 }, ...]

    if (!Array.isArray(order) || order.length === 0) {
      return next(new AppError('Invalid order array', 400));
    }

    const category = await FAQCategory.findById(categoryId);
    if (!category) return next(new AppError('Category not found', 404));

    const updates = order.map(({ faqId, order: newOrder }) => ({
      updateOne: {
        filter: { _id: faqId, category: categoryId },
        update: { order: newOrder },
      },
    }));

    await FAQ.bulkWrite(updates);
    res.json({ message: 'FAQs reordered successfully' });
  } catch (err) {
    next(err);
  }
};

// ---------- SEARCH ----------
exports.searchFaqs = async (req, res, next) => {
  try {
    const { q, category, tags, language, page, limit } = req.query;

    const filter = { isActive: true };

    if (category) filter.category = category;
    if (language) filter.language = language;
    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim());
      filter.tags = { $all: tagArray };
    }
    if (q) {
      filter.$text = { $search: q };
    }

    const { data, pagination } = await paginate(FAQ, filter, {
      page,
      limit,
      sort: { order: 1, createdAt: -1 },
    });

    // Populate category name for convenience
    const populated = await Promise.all(
      data.map(async (faq) => {
        const cat = await FAQCategory.findById(faq.category).select('name');
        return {
          ...faq.toObject(),
          category: cat ? { _id: cat._id, name: cat.name } : null,
        };
      })
    );

    res.json({ data: populated, pagination });
  } catch (err) {
    next(err);
  }
};