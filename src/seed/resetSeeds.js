// src/seed/resetSeeds.js
const mongoose = require('mongoose');
const path = require('path');

// Load environment variables from root
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Import models from src folder
const User = require('../models/User');
const Department = require('../models/Department');

async function resetSeeds() {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/staffsync';
    console.log(`🔌 Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***@')}`);
    
    // Connect to MongoDB
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Find seeded users
    const hrUser = await User.findOne({ employeeId: 'HR001' });
    const empUser = await User.findOne({ employeeId: 'EMP001' });

    let deleted = [];

    if (hrUser) {
      await hrUser.deleteOne();
      deleted.push(`HR User (${hrUser.employeeId})`);
      console.log(`🗑️ Deleted HR user: ${hrUser.firstName} ${hrUser.lastName} (${hrUser.employeeId})`);
    }

    if (empUser) {
      await empUser.deleteOne();
      deleted.push(`Employee User (${empUser.employeeId})`);
      console.log(`🗑️ Deleted Employee user: ${empUser.firstName} ${empUser.lastName} (${empUser.employeeId})`);
    }

    if (deleted.length === 0) {
      console.log('⚠️ No seeded users found to delete');
    } else {
      console.log(`\n✅ Successfully deleted ${deleted.length} user(s):`);
      deleted.forEach(user => console.log(`   - ${user}`));
    }

    // Optional: Clean up departments if they have no employees
    const hrDept = await Department.findOne({ name: { $regex: /^HUMAN RESOURCES$/i } });
    if (hrDept) {
      const employeeCount = await User.countDocuments({ department: hrDept._id });
      if (employeeCount === 0) {
        await hrDept.deleteOne();
        console.log(`🗑️ Deleted empty HR department: ${hrDept.name}`);
      } else {
        console.log(`ℹ️ HR department has ${employeeCount} employee(s) - not deleting`);
      }
    }

    const empDept = await Department.findOne({ name: { $regex: /^ENGINEERING$/i } });
    if (empDept) {
      const employeeCount = await User.countDocuments({ department: empDept._id });
      if (employeeCount === 0) {
        await empDept.deleteOne();
        console.log(`🗑️ Deleted empty Engineering department: ${empDept.name}`);
      } else {
        console.log(`ℹ️ Engineering department has ${employeeCount} employee(s) - not deleting`);
      }
    }

    console.log('\n🎉 Reset completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error resetting seeds:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

resetSeeds();