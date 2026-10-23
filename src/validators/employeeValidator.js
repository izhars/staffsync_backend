const { body } = require('express-validator');

exports.createEmployeeValidator = [
  body('employeeId')
    .notEmpty().withMessage('Employee ID is required')
    .isLength({ min: 6, max: 10 })
    .withMessage('Employee ID must be 6–10 characters')
    .matches(/^[A-Z]{7}\d{3}$/)
    .withMessage('Employee ID format: 7 letters followed by 3 digits, e.g., SCAIPLE001'),

  body('email')
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),

  body('firstName')
    .notEmpty().withMessage('First name is required'),

  body('lastName')
    .notEmpty().withMessage('Last name is required'),

  body('phone')
    .optional()
    .matches(/^\d{10}$/).withMessage('Phone number must be 10 digits')
];