const mongoose = require('mongoose');

const performanceSchema = new mongoose.Schema({
  employee: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  
  reviewPeriod: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true }
  },
  
  reviewer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  
  ratings: [{
    parameter: { type: String, required: true }, // e.g., 'Communication', 'Technical Skills'
    score: { type: Number, required: true, min: 1, max: 5 },
    comments: String
  }],
  
  overallRating: { type: Number, min: 1, max: 5 },
  
  strengths: [String],
  areasOfImprovement: [String],
  
  goals: [{
    description: String,
    targetDate: Date,
    status: { type: String, enum: ['pending', 'in-progress', 'achieved'], default: 'pending' }
  }],
  
  feedback: String,
  employeeComments: String,
  
  status: { 
    type: String, 
    enum: ['draft', 'submitted', 'acknowledged'], 
    default: 'draft' 
  },
  
  submittedAt: Date,
  acknowledgedAt: Date
}, {
  timestamps: true
});

// Calculate overall rating before saving
performanceSchema.pre('save', function(next) {
  if (this.ratings && this.ratings.length > 0) {
    const totalScore = this.ratings.reduce((sum, rating) => sum + rating.score, 0);
    this.overallRating = Math.round((totalScore / this.ratings.length) * 10) / 10;
  }
  next();
});

module.exports = mongoose.model('Performance', performanceSchema);