const { body, validationResult } = require('express-validator');

exports.registerValidator = [
  body('employeeId')
    .isLength({ min: 6, max: 10 })
    .matches(/^[A-Z]{7}\d{3}$/)
    .withMessage('Employee ID format: 7 letters followed by 3 digits, e.g., SCAIPLE001'),

  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number and special character'),

  body('firstName', 'First name is required').notEmpty().trim().escape(),
  body('lastName', 'Last name is required').notEmpty().trim().escape(),
  body('phone')
    .isLength({ min: 10, max: 10 })
    .withMessage('Phone must be 10 digits')
    .isNumeric()
    .withMessage('Phone must contain only numbers'),

  body('maritalStatus')
    .isIn(['single', 'married', 'divorced', 'widowed', 'separated'])
    .withMessage('Invalid marital status'),

  body('marriageAnniversary')
    .optional({ checkFalsy: true })
    .if(body('maritalStatus').equals('married'))
    .notEmpty()
    .withMessage('Marriage anniversary is required for married employees')
    .isISO8601()
    .toDate()
    .custom((value) => {
      const today = new Date();
      return value < today;
    })
    .withMessage('Marriage anniversary must be in the past'),

  body('dateOfBirth')
    .notEmpty()
    .isISO8601()
    .toDate()
    .custom((value) => {
      return value < new Date();
    })
    .withMessage('Date of birth must be in the past'),

  body('spouseDetails.name')
    .optional({ checkFalsy: true })
    .if(body('maritalStatus').equals('married'))
    .notEmpty()
    .withMessage('Spouse name is required for married employees')
    .trim()
    .escape(),

  body('salary.basic').optional().isFloat({ min: 0 }).withMessage('Basic salary must be positive'),
  body('panNumber')
    .optional()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage('Invalid PAN format'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    next();
  }
];

exports.validateUpdateProfile = [
  body('maritalStatus')
    .optional()
    .isIn(['single', 'married', 'divorced', 'widowed', 'separated'])
    .withMessage('Invalid marital status'),

  body('marriageAnniversary')
    .optional({ checkFalsy: true })
    .if(body('maritalStatus').equals('married'))
    .notEmpty()
    .withMessage('Marriage anniversary is required for married employees')
    .isISO8601()
    .toDate()
    .custom((value) => value < new Date())
    .withMessage('Marriage anniversary must be in the past'),

  body('spouseDetails.name')
    .optional({ checkFalsy: true })
    .if(body('maritalStatus').equals('married'))
    .notEmpty()
    .withMessage('Spouse name is required for married employees'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    next();
  }
];

exports.loginValidator = [
  body('identifier').optional().trim().notEmpty().withMessage('identifier cannot be empty'),
  body('email').optional().trim().isEmail().withMessage('Please provide a valid email'),
  body('employeeId').optional().trim().notEmpty().withMessage('employeeId cannot be empty'),
  body('password').notEmpty().withMessage('Password is required'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { identifier, email, employeeId } = req.body;
    if (!identifier && !email && !employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: [
          {
            type: 'field',
            msg: 'Please provide email, employeeId, or identifier',
          },
        ],
      });
    }

    next();
  },
];