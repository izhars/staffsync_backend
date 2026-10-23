const Joi = require('joi');

exports.createCategorySchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().allow('').optional(),
  order: Joi.number().integer().min(0).optional(),
});

exports.updateCategorySchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  description: Joi.string().allow('').optional(),
  order: Joi.number().integer().min(0).optional(),
}).min(1); // at least one field

exports.createFaqSchema = Joi.object({
  question: Joi.string().trim().min(1).max(500).required(),
  answer: Joi.string().trim().min(1).max(5000).required(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  order: Joi.number().integer().min(0).optional(),
  language: Joi.string().length(2).default('en'),
});

exports.updateFaqSchema = Joi.object({
  question: Joi.string().trim().min(1).max(500).optional(),
  answer: Joi.string().trim().min(1).max(5000).optional(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  order: Joi.number().integer().min(0).optional(),
  language: Joi.string().length(2).optional(),
  isActive: Joi.boolean().optional(),
}).min(1);