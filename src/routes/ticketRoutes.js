const express = require('express');
const router = express.Router();
const { protect, hrAndAbove } = require('../middleware/auth');
const { createTicket, getUserTickets } = require('../controllers/ticketController');
router.post('/',protect, hrAndAbove, createTicket);
router.get('/:userId',protect, getUserTickets);
module.exports = router;