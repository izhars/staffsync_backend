const Feedback = require('../models/Feedback');
const { Parser } = require('json2csv');
const XLSX = require('xlsx');
const mongoose = require('mongoose'); // ← REQUIRED

/* --------------------------------------------------------------
   BASIC SENTIMENT (keep as-is – you can swap for an AI later)
   -------------------------------------------------------------- */
const detectSentiment = (text) => {
  if (!text) return 'neutral';
  const positiveWords = ['good','great','happy','love','amazing','helpful','satisfied'];
  const negativeWords = ['bad','poor','angry','hate','stress','toxic','unhappy','frustrated'];
  const lower = text.toLowerCase();
  const pos = positiveWords.filter(w => lower.includes(w)).length;
  const neg = negativeWords.filter(w => lower.includes(w)).length;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
};

/* --------------------------------------------------------------
   CREATE FEEDBACK (already solid – tiny tweak for safety)
   -------------------------------------------------------------- */
exports.createFeedback = async (req, res) => {
  try {
    const { message, category, isAnonymous } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    if (category && !['work_environment','management','benefits','other'].includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid category' });
    }

    const sentiment = detectSentiment(message);

    const feedback = await Feedback.create({
      userId: isAnonymous ? null : req.user?.id || null,
      message: message.trim(),
      category: category || 'other',
      isAnonymous: !!isAnonymous,
      sentiment,
    });

    res.status(201).json({ success: true, feedback });
  } catch (err) {
    console.error('createFeedback error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/* --------------------------------------------------------------
   SUMMARY (already good – left untouched)
   -------------------------------------------------------------- */
exports.getFeedbackSummary = async (req, res) => {
  try {
    const feedbacks = await Feedback.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const total = feedbacks.reduce((s, i) => s + i.count, 0);
    const summary = feedbacks.map(item => ({
      category: item._id,
      count: item.count,
      percentage: total ? ((item.count / total) * 100).toFixed(2) + '%' : '0.00%',
    }));

    res.status(200).json({ success: true, total, summary });
  } catch (err) {
    console.error('getFeedbackSummary error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/* --------------------------------------------------------------
   ANALYTICS – sentiment + trend over time
   -------------------------------------------------------------- */
exports.getFeedbackAnalytics = async (req, res) => {
  try {
    const { start, end } = req.query;
    const dateFilter = {};
    if (start && end) {
      dateFilter.createdAt = { $gte: new Date(start), $lte: new Date(end) };
    }

    // 1. Sentiment distribution
    const sentimentAgg = await Feedback.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$sentiment', count: { $sum: 1 } } },
    ]);

    // 2. Daily trend (last 30 days if no range supplied)
    const trendStart = start ? new Date(start) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const trendEnd   = end   ? new Date(end)   : new Date();

    const dailyTrend = await Feedback.aggregate([
      {
        $match: {
          createdAt: { $gte: trendStart, $lte: trendEnd },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          positive: {
            $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] },
          },
          negative: {
            $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] },
          },
          neutral: {
            $sum: { $cond: [{ $eq: ['$sentiment', 'neutral'] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      success: true,
      sentiment: Object.fromEntries(sentimentAgg.map(s => [s._id, s.count])),
      dailyTrend,
    });
  } catch (err) {
    console.error('getFeedbackAnalytics error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/* --------------------------------------------------------------
   EXPORT (CSV + XLSX)
   -------------------------------------------------------------- */
exports.exportFeedbacks = async (req, res) => {
  try {
    const { format = 'csv', category, start, end } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (start && end) {
      filter.createdAt = { $gte: new Date(start), $lte: new Date(end) };
    }

    const feedbacks = await Feedback.find(filter)
      .populate({
        path: 'userId',
        select: 'name email',
      })
      .sort({ createdAt: -1 })
      .lean();

    // Resolve respondedBy names in parallel
    const rows = await Promise.all(
      feedbacks.map(async (f) => {
        let respondedByName = '';
        if (f.adminResponse?.respondedBy) {
          const adminUser = await mongoose.model('User')
            .findById(f.adminResponse.respondedBy)
            .select('name')
            .lean();
          respondedByName = adminUser?.name || '';
        }

        return {
          ID: f._id,
          Date: new Date(f.createdAt).toISOString().split('T')[0],
          Category: f.category,
          Sentiment: f.sentiment,
          Anonymous: f.isAnonymous ? 'Yes' : 'No',
          User: f.isAnonymous ? 'Anonymous' : (f.userId?.name || '—'),
          Email: f.isAnonymous ? '' : (f.userId?.email || ''),
          Message: f.message,
          Response: f.adminResponse?.message || '',
          RespondedBy: respondedByName,
        };
      })
    );

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Feedback');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res
        .set({
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename=feedbacks.xlsx',
        })
        .send(buf);
    } else {
      const fields = [
        'ID', 'Date', 'Category', 'Sentiment', 'Anonymous',
        'User', 'Email', 'Message', 'Response', 'RespondedBy',
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(rows);

      res
        .set({
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=feedbacks.csv',
        })
        .send(csv);
    }
  } catch (err) {
    console.error('exportFeedbacks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/* --------------------------------------------------------------
   RESPOND TO FEEDBACK
   -------------------------------------------------------------- */
exports.respondToFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Response message required' });
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: 'Feedback not found' });
    }

    // Update (or create) adminResponse sub-doc
    feedback.adminResponse = {
      message: message.trim(),
      respondedBy: req.user.id,
      respondedAt: new Date(),
    };

    await feedback.save();

    res.status(200).json({ success: true, feedback });
  } catch (err) {
    console.error('respondToFeedback error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/* --------------------------------------------------------------
   LIST ALL (already good – tiny pagination add-on)
   -------------------------------------------------------------- */
exports.getAllFeedbacks = async (req, res) => {
  try {
    const {
      category,
      isAnonymous,
      start,
      end,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (isAnonymous !== undefined) filter.isAnonymous = isAnonymous === 'true';
    if (start && end) {
      filter.createdAt = { $gte: new Date(start), $lte: new Date(end) };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [feedbacks, total] = await Promise.all([
      Feedback.find(filter)
        .populate({
          path: 'userId',
          select: 'name email role',
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Feedback.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: feedbacks.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      feedbacks,
    });
  } catch (err) {
    console.error('getAllFeedbacks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};