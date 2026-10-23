// routes/faqRoutes.js
const express = require('express');
const router = express.Router();

const {
    getAllCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    getCategoryList,
    addFaqToCategory,
    updateFaq,
    deleteFaq,
    reorderFaqs,
    searchFaqs
} = require('../controllers/faqController');

const { protect, hrAndAbove } = require('../middleware/auth');

// ----------- PUBLIC ROUTES -----------
router.get('/', getAllCategories);            // Fetch all categories + FAQs
router.get('/search', searchFaqs);            // Public search

// ----------- PROTECTED (HR+) -----------
router.post('/', protect, hrAndAbove, addCategory);
router.get('/category', protect, getCategoryList);      // All category
router.patch('/:categoryId', protect, hrAndAbove, updateCategory);     // Update category
router.delete('/:categoryId', protect, hrAndAbove, deleteCategory);    // Delete category

router.post('/:categoryId/faqs', protect, hrAndAbove, addFaqToCategory);   // Add FAQ
router.patch('/faq/:faqId', protect, hrAndAbove, updateFaq);              // Update FAQ
router.delete('/faq/:faqId', protect, hrAndAbove, deleteFaq);             // Delete FAQ

router.post('/:categoryId/faqs/reorder', protect, hrAndAbove, reorderFaqs); // Bulk reorder FAQs

module.exports = router;
