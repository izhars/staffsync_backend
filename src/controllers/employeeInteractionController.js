const { 
  sendEmployeeInteractionNotification,
  logEmployeeInteraction,
  getUserInteractions,
  getInteractionStats
} = require('../firebase/notificationService');

const EmployeeInteraction = require('../models/EmployeeInteraction');

/**
 * Get user's interaction history
 */
async function getUserInteractionHistory(req, res) {
  try {
    const userId = req.user._id;
    const { 
      limit = 50, 
      offset = 0, 
      interactionType,
      startDate,
      endDate 
    } = req.query;

    const interactions = await getUserInteractions(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      interactionType,
      startDate,
      endDate
    });

    // Format the response
    const formattedInteractions = interactions.map(interaction => ({
      id: interaction._id,
      type: interaction.interactionType,
      readableType: formatInteractionType(interaction.interactionType),
      sender: interaction.senderId ? {
        id: interaction.senderId._id,
        name: `${interaction.senderId.firstName || ''} ${interaction.senderId.lastName || ''}`.trim(),
        profilePicture: interaction.senderId.profilePicture
      } : null,
      receiver: interaction.receiverId ? {
        id: interaction.receiverId._id,
        name: `${interaction.receiverId.firstName || ''} ${interaction.receiverId.lastName || ''}`.trim(),
        profilePicture: interaction.receiverId.profilePicture
      } : null,
      isIncoming: interaction.receiverId._id.toString() === userId.toString(),
      isOutgoing: interaction.senderId._id.toString() === userId.toString(),
      notificationSent: interaction.notificationSent,
      metadata: interaction.metadata,
      timestamp: interaction.timestamp || interaction.createdAt,
      createdAt: interaction.createdAt
    }));

    res.json({
      success: true,
      interactions: formattedInteractions,
      count: formattedInteractions.length
    });
  } catch (error) {
    console.error('🔥 Error getting interaction history:', error);
    res.status(500).json({ error: 'Failed to get interaction history' });
  }
}

/**
 * Helper function to format interaction type
 */
function formatInteractionType(type) {
  const typeMap = {
    'viewed_profile': 'Viewed Profile',
    'viewed_contact': 'Viewed Contact',
    'messaged': 'Messaged',
    'shared_profile': 'Shared Profile',
    'saved_contact': 'Saved Contact',
    'downloaded_resume': 'Downloaded Resume',
    'started_call': 'Started Call',
    'accepted_call': 'Accepted Call',
    'declined_call': 'Declined Call',
    'missed_call': 'Missed Call',
    'ended_call': 'Ended Call'
  };
  return typeMap[type] || type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Get interaction statistics
 */
async function getInteractionStatistics(req, res) {
  try {
    const userId = req.user._id;
    const stats = await getInteractionStats(userId);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('🔥 Error getting interaction statistics:', error);
    res.status(500).json({ error: 'Failed to get interaction statistics' });
  }
}

/**
 * Track call interaction
 */
async function trackCallInteraction(req, res) {
  try {
    const {
      receiverId,
      callType = 'audio',
      callStatus,
      duration = 0
    } = req.body;

    const senderId = req.user._id;

    if (!receiverId) {
      return res.status(400).json({ error: 'receiverId is required' });
    }

    if (!['started', 'accepted', 'declined', 'ended', 'missed'].includes(callStatus)) {
      return res.status(400).json({ 
        error: 'callStatus must be one of: started, accepted, declined, ended, missed' 
      });
    }

    // Map to proper enum value
    const interactionTypeMap = {
      started: 'started_call',
      accepted: 'accepted_call',
      declined: 'declined_call',
      ended: 'ended_call',
      missed: 'missed_call'
    };

    const interactionType = interactionTypeMap[callStatus];

    if (!interactionType) {
      return res.status(400).json({ error: 'Invalid call status' });
    }

    // ✅ Log the interaction only, skip sending notification
    await logEmployeeInteraction({
      senderId,
      receiverId,
      interactionType,
      notificationSent: false, // explicitly false
      metadata: {
        callType,
        callStatus,
        duration,
        timestamp: new Date().toISOString()
      }
    });

    res.json({
      success: true,
      notificationSent: false,
      interactionType,
      message: 'Call interaction tracked (no notification sent)'
    });

  } catch (error) {
    console.error('🔥 Error tracking call interaction:', error);
    res.status(500).json({ error: 'Failed to track call interaction' });
  }
}


/**
 * Track call end (call drop / hang up)
 */
async function trackCallEnd(req, res) {
  try {
    const {
      receiverId,
      callStatus = 'ended',
      endedAt,
      callDuration = 0
    } = req.body;

    const senderId = req.user._id;

    if (!receiverId) {
      return res.status(400).json({ error: 'receiverId is required' });
    }

    // Decide if this was a missed call
    const interactionType = callDuration === 0 ? 'missed_call' : 'ended_call';

    // ✅ Log the interaction only, skip sending notification
    await logEmployeeInteraction({
      senderId,
      receiverId,
      interactionType,
      notificationSent: false, // explicitly false
      metadata: {
        callStatus,
        duration: callDuration,
        endedAt: endedAt || new Date().toISOString()
      }
    });

    res.json({
      success: true,
      interactionType,
      notificationSent: false,
      message: 'Call end tracked successfully (no notification sent)'
    });

  } catch (error) {
    console.error('🔥 Error tracking call end:', error);
    res.status(500).json({ error: 'Failed to track call end' });
  }
}


module.exports = {
  getUserInteractionHistory,
  getInteractionStatistics,
  trackCallInteraction,
  trackCallEnd
};