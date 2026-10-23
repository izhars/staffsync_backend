const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  assetId: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  
  category: { 
    type: String, 
    enum: ['laptop', 'desktop', 'mobile', 'tablet', 'accessories', 'furniture', 'other'],
    required: true 
  },
  
  description: String,
  brand: String,
  model: String,
  serialNumber: String,
  
  purchaseDate: Date,
  purchasePrice: Number,
  warrantyExpiryDate: Date,
  
  status: { 
    type: String, 
    enum: ['available', 'assigned', 'under-maintenance', 'retired'],
    default: 'available' 
  },
  
  assignedTo: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  assignedDate: Date,
  
  assignmentHistory: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedDate: Date,
    returnedDate: Date,
    condition: { type: String, enum: ['good', 'fair', 'poor'] },
    remarks: String
  }],
  
  condition: { 
    type: String, 
    enum: ['excellent', 'good', 'fair', 'poor'],
    default: 'excellent' 
  },
  
  location: String,
  remarks: String
}, {
  timestamps: true
});

// ✅ Export as a Mongoose model
module.exports = mongoose.model('Asset', assetSchema);
