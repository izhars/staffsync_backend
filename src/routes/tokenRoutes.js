const express = require('express');
const router = express.Router();

const {
  getAllTokens,
  getTokenByUser,
  deleteTokenById
} = require('../controllers/tokenController');

const { protect, hrAndAbove } = require('../middleware/auth');

// 🔐 Only HR & SuperAdmin can see tokens

// 📜 List all tokens
router.get('/', protect, hrAndAbove, getAllTokens);

// 👤 Get token of specific user
router.get('/:userId', protect, hrAndAbove, getTokenByUser);

// DELETE token by userId
router.delete('/by-id/:tokenId', protect, deleteTokenById);

module.exports = router;
