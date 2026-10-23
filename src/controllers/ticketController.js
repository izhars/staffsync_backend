const Ticket = require('../models/Ticket');
exports.createTicket = async (req, res) => {
  try {
    const { userId, subject, message } = req.body;
    const ticket = new Ticket({ userId, subject, message });
    await ticket.save();
    res.status(201).json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getUserTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    const tickets = await Ticket.find({ userId });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};