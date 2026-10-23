const { body, param, query } = require('express-validator');

const expenseValidator = {
  createExpense: [
    body('title')
      .trim()
      .notEmpty().withMessage('Title is required')
      .isLength({ max: 100 }).withMessage('Title must be less than 100 characters'),
    
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
    
    body('amount')
      .isFloat({ min: 0 }).withMessage('Amount must be a positive number')
      .toFloat(),
    
    body('currency')
      .optional()
      .isIn(['USD', 'EUR', 'GBP', 'INR', 'JPY']).withMessage('Invalid currency'),
    
    body('category')
      .isMongoId().withMessage('Invalid category ID')
      .notEmpty().withMessage('Category is required'),
    
    body('status')
      .optional()
      .isIn(['draft', 'submitted']).withMessage('Invalid status')
  ],

  submitExpense: [
    param('id')
      .isMongoId().withMessage('Invalid expense ID')
  ],

  approveExpense: [
    param('id')
      .isMongoId().withMessage('Invalid expense ID'),
    
    body('status')
      .isIn(['approved', 'rejected']).withMessage('Status must be either approved or rejected'),
    
    body('comments')
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage('Comments must be less than 500 characters')
  ],

  getExpenses: [
    query('status')
      .optional()
      .isIn(['draft', 'submitted', 'approved', 'rejected', 'paid']),
    
    query('startDate')
      .optional()
      .isISO8601().withMessage('Invalid start date'),
    
    query('endDate')
      .optional()
      .isISO8601().withMessage('Invalid end date'),
    
    query('category')
      .optional()
      .isMongoId().withMessage('Invalid category ID'),
    
    query('page')
      .optional()
      .isInt({ min: 1 }).withMessage('Page must be a positive integer')
      .toInt(),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
      .toInt()
  ]
};

module.exports = expenseValidator;