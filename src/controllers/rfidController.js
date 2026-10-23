// src/controllers/rfidController.js
const RfidScan = require('../models/RfidScan');
const { uploadRfidImage, deleteRfidImage } = require('../middleware/upload');

const createRfidScan = async (req, res) => {
  try {
    console.log('📥 Incoming RFID Scan Request');
    console.log('🧾 Raw req.body:', req.body);

    let rfidData;

    // Parse RFID data (required)
    try {
      rfidData = JSON.parse(req.body.rfid_data);
      console.log('✅ Parsed rfid_data:', rfidData);
    } catch (err) {
      console.error('❌ Failed to parse rfid_data:', err);
      return res.status(400).json({
        success: false,
        message: 'Invalid rfid_data JSON',
      });
    }

    const { 
      epc, 
      rssi, 
      tid = '', 
      count, 
      total_reads, 
      timestamp,
      lane_entry_id,
      lane_name,
      reader_name
    } = rfidData;

    // Validate required fields
    const requiredFields = ['epc', 'rssi', 'count', 'total_reads', 'timestamp'];
    const missingFields = requiredFields.filter(field => !rfidData[field]);

    if (missingFields.length > 0) {
      console.warn('⚠️ Missing RFID fields:', missingFields);
      return res.status(400).json({
        success: false,
        message: `Missing RFID fields: ${missingFields.join(', ')}`,
      });
    }

    // Handle optional images
    const photos = [];

    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      console.log(`🖼️ ${req.files.length} image(s) received for EPC: ${epc}`);
      
      for (const file of req.files) {
        try {
          if (!file.buffer) {
            console.warn('⚠️ File missing buffer, skipping:', file.originalname);
            continue;
          }

          const uploaded = await uploadRfidImage(file.buffer, epc, {
            originalName: file.originalname,
          });

          photos.push({
            url: uploaded.url,
            publicId: uploaded.publicId,
            bytes: uploaded.bytes,
            format: uploaded.format,
            originalName: file.originalname,
            filename: uploaded.publicId,
            path: uploaded.url,
            size: uploaded.bytes,
            uploadDate: new Date(),
          });

          console.log('☁️ Image uploaded:', uploaded.publicId);
        } catch (uploadErr) {
          console.error('❌ Image upload failed:', uploadErr.message);
        }
      }
    } else {
      console.log('ℹ️ No images uploaded');
    }

    const payload = {
      epc,
      rssi,
      tid,
      count,
      total_reads,
      timestamp: new Date(timestamp),
      lane_entry_id,
      lane_name,
      reader_name,
      photos,
      scanReceivedAt: new Date(),
    };

    console.log('🧩 Final DB payload:', {
      ...payload,
      photosCount: photos.length,
      lane_info: lane_entry_id ? `Lane ${lane_entry_id} (${lane_name})` : 'No lane info'
    });

    const scan = await RfidScan.create(payload);

    console.log('✅ RFID scan saved:', scan._id);

    res.status(201).json({
      success: true,
      message: photos.length > 0
        ? 'RFID scan saved with images'
        : 'RFID scan saved (no images)',
      data: {
        id: scan._id,
        epc: scan.epc,
        count: scan.count,
        timestamp: scan.timestamp,
        lane_entry_id: scan.lane_entry_id,
        lane_name: scan.lane_name,
        reader_name: scan.reader_name,
        photosCount: scan.photos.length,
        photos: scan.photos.map(p => ({
          url: p.url,
          publicId: p.publicId,
          originalName: p.originalName,
          size: p.bytes || p.size
        }))
      },
    });
  } catch (err) {
    console.error('🔥 RFID scan creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

const getRecentScans = async (req, res) => {
  try {
    const scans = await RfidScan.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .select('epc rssi count timestamp lane_entry_id lane_name reader_name photos');

    res.json({
      success: true,
      count: scans.length,
      data: scans,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getScansGroupedByDate = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const skip = (page - 1) * limit;

    const pipeline = [
      {
        $addFields: {
          scanDate: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$timestamp",
              timezone: "Asia/Kolkata"
            }
          }
        }
      },
      {
        $group: {
          _id: "$scanDate",
          totalScans: { $sum: 1 },
          scans: {
            $push: {
              _id: "$_id",
              epc: "$epc",
              rssi: "$rssi",
              tid: "$tid",
              count: "$count",
              total_reads: "$total_reads",
              timestamp: "$timestamp",
              lane_entry_id: "$lane_entry_id",
              lane_name: "$lane_name",
              reader_name: "$reader_name",
              photos: "$photos",
              scanReceivedAt: "$scanReceivedAt",
              createdAt: "$createdAt"
            }
          }
        }
      },
      { $sort: { _id: -1 } },
      {
        $facet: {
          meta: [
            { $count: "totalDates" }
          ],
          data: [
            { $skip: skip },
            { $limit: limit }
          ]
        }
      }
    ];

    const result = await RfidScan.aggregate(pipeline);

    const totalDates = result[0].meta[0]?.totalDates || 0;
    const totalPages = Math.ceil(totalDates / limit);

    res.json({
      success: true,
      meta: {
        page,
        limit,
        totalDates,
        totalPages,
        hasNextPage: page < totalPages
      },
      data: result[0].data
    });

  } catch (err) {
    console.error('🔥 Date-wise pagination error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch paginated date-wise RFID scans'
    });
  }
};

const getScansByLane = async (req, res) => {
  try {
    const { lane_entry_id } = req.params;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;

    const scans = await RfidScan.find({ lane_entry_id })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .select('epc rssi count timestamp lane_entry_id lane_name reader_name photos');

    const totalScans = await RfidScan.countDocuments({ lane_entry_id });
    const totalPages = Math.ceil(totalScans / limit);

    res.json({
      success: true,
      meta: {
        page,
        limit,
        totalScans,
        totalPages,
        hasNextPage: page < totalPages
      },
      data: scans,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getLaneStatistics = async (req, res) => {
  try {
    const pipeline = [
      {
        $match: {
          lane_entry_id: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: "$lane_entry_id",
          lane_name: { $first: "$lane_name" },
          totalScans: { $sum: 1 },
          lastScan: { $max: "$timestamp" },
          epcCount: { $addToSet: "$epc" }
        }
      },
      {
        $project: {
          lane_entry_id: "$_id",
          lane_name: 1,
          totalScans: 1,
          uniqueEpcs: { $size: "$epcCount" },
          lastScan: 1
        }
      },
      { $sort: { totalScans: -1 } }
    ];

    const laneStats = await RfidScan.aggregate(pipeline);

    res.json({
      success: true,
      data: laneStats,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


const getOnlyMedia = async (req, res) => {
  try {
    const scans = await RfidScan.find({
      photos: { $exists: true, $ne: [] }
    }).select('photos');

    // Flatten all photos into one array
    const media = scans.flatMap(scan =>
      scan.photos.map(photo => ({
        url: photo.url,
        publicId: photo.publicId,
        originalName: photo.originalName,
        size: photo.bytes || photo.size,
        uploadDate: photo.uploadDate
      }))
    );

    res.json({
      success: true,
      count: media.length,
      data: media
    });

  } catch (err) {
    console.error('🔥 Media fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media'
    });
  }
};


const deleteRfidScan = async (req, res) => {
  try {
    const { id } = req.params;

    const scan = await RfidScan.findById(id);

    if (!scan) {
      return res.status(404).json({
        success: false,
        message: 'RFID scan not found'
      });
    }

    // 🔥 Delete all images from Cloudinary first
    if (scan.photos && scan.photos.length > 0) {
      for (const photo of scan.photos) {
        if (photo.publicId) {
          try {
            await deleteRfidImage(photo.publicId);
            console.log(`☁️ Deleted from Cloudinary: ${photo.publicId}`);
          } catch (err) {
            console.error(`❌ Failed to delete ${photo.publicId}`);
          }
        }
      }
    }

    // 🗑 Delete document from MongoDB
    await RfidScan.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'RFID scan and associated images deleted successfully'
    });

  } catch (err) {
    console.error('🔥 Delete error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete RFID scan'
    });
  }
};


module.exports = {
  createRfidScan,
  getRecentScans,
  getScansGroupedByDate,
  getScansByLane,
  getLaneStatistics,
  getOnlyMedia,
  deleteRfidScan
};
