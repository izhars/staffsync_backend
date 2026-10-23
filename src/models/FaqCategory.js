// models/faqCategory.js
const mongoose = require('mongoose');

const faqCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  description: { type: String },               // extra info
  order: { type: Number, default: 0 },         // for UI ordering
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('FAQCategory', faqCategorySchema);