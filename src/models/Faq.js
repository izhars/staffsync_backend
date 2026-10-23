// models/faq.js
const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  answer:   { type: String, required: true },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FAQCategory',
    required: true,
    index: true,               // <-- fast look-ups
  },
  tags: [{ type: String, trim: true }], // e.g. ["billing","premium"]
  order: { type: Number, default: 0 },   // drag-and-drop
  isActive: { type: Boolean, default: true },
  language: { type: String, default: 'en' }, // future i18n
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date },
});

// Auto-update `updatedAt`
faqSchema.pre('findOneAndUpdate', function () {
  this.set({ updatedAt: new Date() });
});

module.exports = mongoose.model('FAQ', faqSchema);