const User = require('../models/User');

exports.getUsersByRole = async (req, res) => {
  try {
    const { role } = req.query;
    const users = await User.find({ 
      role, 
      isActive: true 
    }).select('userId name email department lastSeen');

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.user;
    const user = await User.findOne({ userId }).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateLastSeen = async (req, res) => {
  try {
    const { userId } = req.user;
    await User.findOneAndUpdate(
      { userId },
      { lastSeen: new Date() }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Update last seen error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};