const Token = require('../models/Token');

// ----------------------------------
// 📜 Get all active tokens
// ----------------------------------
exports.getAllTokens = async (req, res) => {
    try {
        const tokens = await Token.find()
            .populate('user', 'firstName lastName email role')
            .sort({ updatedAt: -1 });

        res.status(200).json({
            success: true,
            count: tokens.length,
            data: tokens,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ----------------------------------
// 👤 Get token by user ID
// ----------------------------------
exports.getTokenByUser = async (req, res) => {
    try {
        const token = await Token.findOne({ user: req.params.userId })
            .populate('user', 'firstName lastName email role');

        if (!token) {
            return res.status(404).json({
                success: false,
                message: 'Token not found for this user',
            });
        }

        res.status(200).json({
            success: true,
            data: token,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ----------------------------------
// ❌ Delete token by token ID
// ----------------------------------
exports.deleteTokenById = async (req, res) => {
  try {
    const tokenDoc = await Token.findById(req.params.tokenId);

    if (!tokenDoc) {
      return res.status(404).json({
        success: false,
        message: 'Token not found',
      });
    }

    // 🔐 Security check
    // HR/SuperAdmin can delete any token
    // Normal user can delete only their own token
    if (
      req.user.role !== 'hr' &&
      req.user.role !== 'superadmin' &&
      tokenDoc.user.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this token',
      });
    }

    await tokenDoc.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Token deleted successfully',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};