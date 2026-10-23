const express = require('express');
const router = express.Router();
const { protect, hrAndAbove } = require('../middleware/auth');
const {
  getAllTopics,
  getTopicById,
  addTopic,
  updateTopic,
  deleteTopic
} = require('../controllers/helpController');

// Public (authenticated) routes
router.get('/', protect, getAllTopics);
router.get('/:id', protect, getTopicById);

// HR+ only routes
router.post('/', protect, hrAndAbove, addTopic);
router.put('/:id', protect, hrAndAbove, updateTopic);
router.delete('/:id', protect, hrAndAbove, deleteTopic);

module.exports = router;