const express = require('express');
const axios = require('axios');
const router = express.Router();

// CORRECT API endpoint based on your test
const NUMBER_PLATE_API = 'http://182.95.242.26:86/Api/TagDetail';

router.get('/', async (req, res) => {
  try {
    // Accept both plateNumber and PlateNumber parameters
    const plateNumber = req.query.plateNumber || req.query.PlateNumber;
    
    if (!plateNumber) {
      return res.status(400).json({ 
        error: 'Plate number is required',
        expectedFormat: '?PlateNumber=YOUR_PLATE'
      });
    }

    console.log(`🔍 Proxying number plate request for: ${plateNumber}`);
    console.log(`📡 Calling: ${NUMBER_PLATE_API}?PlateNumber=${encodeURIComponent(plateNumber)}`);
    
    // Forward the request to the actual API with CORRECT parameter name
    const response = await axios({
      method: 'get',
      url: NUMBER_PLATE_API,
      params: { 
        PlateNumber: plateNumber  // Note: Capital P, capital N
      },
      timeout: 30000,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Response received for ${plateNumber}`);
    
    // Log the response structure to help with extraction
    console.log('📦 Response data type:', typeof response.data);
    console.log('📦 Response structure:', Object.keys(response.data || {}));
    
    res.json(response.data); // Send as JSON
    
  } catch (error) {
    console.error('❌ Number plate API error:', {
      plate: req.query.plateNumber || req.query.PlateNumber,
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message,
      data: error.response?.data
    });

    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Request timeout' });
    }
    
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'External API error',
        details: error.response.data,
        status: error.response.status
      });
    } else if (error.request) {
      return res.status(503).json({ 
        error: 'Number plate API unavailable',
        details: 'Could not connect to external service',
        address: NUMBER_PLATE_API
      });
    } else {
      return res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
      });
    }
  }
});

// Test endpoint specifically for this API
router.get('/test', async (req, res) => {
  const testPlate = 'RJ26CA9991';
  
  try {
    console.log('🧪 Testing number plate API connection...');
    
    const response = await axios({
      method: 'get',
      url: NUMBER_PLATE_API,
      params: { PlateNumber: testPlate },
      timeout: 10000,
      validateStatus: false // Don't throw on any status
    });

    res.json({
      success: true,
      testPlate,
      apiUrl: NUMBER_PLATE_API,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.json({
      success: false,
      testPlate,
      apiUrl: NUMBER_PLATE_API,
      error: error.message,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Number Plate Proxy',
    target: NUMBER_PLATE_API,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;