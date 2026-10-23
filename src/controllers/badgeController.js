const Badge = require('../models/Badge');
const { uploadToCloudinary, deleteFromCloudinary } = require('../middleware/upload');

// ✅ Create Badge (Upload to Cloudinary)
exports.createBadge = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please upload a badge image' 
      });
    }

    // Upload buffer to Cloudinary - FIXED: pass 'badge' as the upload type
    let cloudinaryResult;
    try {
      cloudinaryResult = await uploadToCloudinary(req.file.buffer, 'badge', {
        folder: 'badges',
        resource_type: 'image',
        transformation: [
          { width: 300, height: 300, crop: 'fill' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      });
    } catch (cloudinaryError) {
      console.error('Cloudinary upload error:', cloudinaryError);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to upload image to Cloudinary',
        error: cloudinaryError.message 
      });
    }

    // Save to DB
    const badge = await Badge.create({
      name,
      description,
      imageUrl: cloudinaryResult.url,
      cloudinaryId: cloudinaryResult.publicId,
    });

    res.status(201).json({ 
      success: true, 
      message: 'Badge created successfully',
      data: badge 
    });

  } catch (err) {
    console.error('Create badge error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Server Error', 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Get all badges
exports.getBadges = async (req, res) => {
  try {
    const badges = await Badge.find().sort({ createdAt: -1 });
    res.json({ 
      success: true, 
      count: badges.length, 
      data: badges 
    });
  } catch (err) {
    console.error('Get badges error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch badges',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Delete badge
exports.deleteBadge = async (req, res) => {
  try {
    const badge = await Badge.findById(req.params.id);
    
    if (!badge) {
      return res.status(404).json({ 
        success: false, 
        message: 'Badge not found' 
      });
    }

    // Delete image from Cloudinary
    if (badge.cloudinaryId) {
      try {
        await deleteFromCloudinary(badge.cloudinaryId);
      } catch (cloudinaryError) {
        console.error('Failed to delete from Cloudinary:', cloudinaryError);
        // Continue with DB deletion even if Cloudinary fails
      }
    }

    // Remove from DB
    await badge.deleteOne();

    res.json({ 
      success: true, 
      message: 'Badge deleted successfully' 
    });

  } catch (err) {
    console.error('Delete badge error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete badge',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};


// ✅ Update Badge
exports.updateBadge = async (req, res) => {
  try {
    const { name, description } = req.body;

    const badge = await Badge.findById(req.params.id);

    if (!badge) {
      return res.status(404).json({
        success: false,
        message: 'Badge not found',
      });
    }

    // Update text fields if provided
    if (name !== undefined) {
      badge.name = name.trim();
    }

    if (description !== undefined) {
      badge.description = description.trim();
    }

    // If new image is uploaded
    if (req.file) {
      let cloudinaryResult;

      try {
        // Upload new image first
        cloudinaryResult = await uploadToCloudinary(
          req.file.buffer,
          'badge',
          {
            folder: 'badges',
            resource_type: 'image',
            transformation: [
              {
                width: 300,
                height: 300,
                crop: 'fill',
              },
              {
                quality: 'auto',
                fetch_format: 'auto',
              },
            ],
          }
        );
      } catch (cloudinaryError) {
        console.error(
          'Cloudinary update upload error:',
          cloudinaryError
        );

        return res.status(500).json({
          success: false,
          message: 'Failed to upload new badge image',
          error: cloudinaryError.message,
        });
      }

      // Keep old Cloudinary ID temporarily
      const oldCloudinaryId = badge.cloudinaryId;

      // Update DB with new image
      badge.imageUrl = cloudinaryResult.url;
      badge.cloudinaryId = cloudinaryResult.publicId;

      await badge.save();

      // Delete old image AFTER successful DB update
      if (oldCloudinaryId) {
        try {
          await deleteFromCloudinary(oldCloudinaryId);
        } catch (cloudinaryError) {
          console.error(
            'Failed to delete old badge image:',
            cloudinaryError
          );
        }
      }
    } else {
      // No new image — just save text changes
      await badge.save();
    }

    res.json({
      success: true,
      message: 'Badge updated successfully',
      data: badge,
    });

  } catch (err) {
    console.error('Update badge error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to update badge',
      error:
        process.env.NODE_ENV === 'development'
          ? err.message
          : undefined,
    });
  }
};