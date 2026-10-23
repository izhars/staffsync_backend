// middleware/validator.js
const { body, param, query, validationResult } = require('express-validator');

exports.validateCreateGroup = [
    body('name')
        .trim()
        .notEmpty().withMessage('Group name is required')
        .isLength({ min: 2, max: 100 }).withMessage('Group name must be between 2-100 characters'),
    body('participantIds')
        .isArray().withMessage('Participants must be an array')
        .custom((ids) => ids.length >= 1).withMessage('At least one participant is required'),
    body('participantIds.*')
        .isMongoId().withMessage('Invalid participant ID'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }
        next();
    }
];

exports.validateConversationId = [
    param('id').isMongoId().withMessage('Invalid conversation ID'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }
        next();
    }
];