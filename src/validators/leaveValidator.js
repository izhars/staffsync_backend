const { body } = require('express-validator');

exports.applyLeaveValidator = [
  body('leaveType')
    .notEmpty().withMessage('Leave type is required')
    .isIn(['casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity'])
    .withMessage('Invalid leave type'),
  
  body('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Invalid start date format'),
  
  body('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('Invalid end date format'),
  
  body('reason')
    .notEmpty().withMessage('Reason is required')
    .isLength({ min: 10 }).withMessage('Reason must be at least 10 characters')
];