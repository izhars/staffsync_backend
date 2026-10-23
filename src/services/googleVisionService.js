// services/googleVisionService.js
const crypto = require('crypto');
const vision = require('@google-cloud/vision');
const fs = require('fs'); // 👈 sync fs
const path = require('path');

class GoogleVisionService {
  constructor() {
    this.client = null;
    this.enabled = false;
    this.credentialsPath = null;
    this.MAX_IMAGE_SIZE = 4 * 1024 * 1024;
    this.RECOMMENDED_SIZE = 2 * 1024 * 1024;
    this.MAX_DIMENSION = 1600;
    this.JPEG_QUALITY = 85;

    try {
      console.log('Initializing Google Vision Service...');

      const envCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CREDENTIALS_PATH;
      const envCredentialsJson = process.env.GOOGLE_VISION_CREDENTIALS_JSON || process.env.GOOGLE_CREDENTIALS_JSON;

      this.credentialsPath = envCredentialsPath || path.resolve(
        __dirname,
        '../config/google-credentials.json'
      );

      console.log('Looking for credentials at:', this.credentialsPath);

      if (envCredentialsJson) {
        const parsedCredentials = JSON.parse(envCredentialsJson);
        this.client = new vision.ImageAnnotatorClient({
          credentials: parsedCredentials
        });
        this.enabled = true;
        console.log('✅ Google Vision client initialized from environment credentials');
        console.log('📋 Project ID:', parsedCredentials.project_id);
        return;
      }

      if (!fs.existsSync(this.credentialsPath)) {
        console.warn('⚠️ Google credentials file not found at:', this.credentialsPath);
        console.warn('⚠️ Google Vision will be disabled for this deployment.');
        this.enabled = false;
        return;
      }

      const credentials = JSON.parse(
        fs.readFileSync(this.credentialsPath, 'utf8')
      );

      if (!credentials.project_id) {
        console.warn('⚠️ credentials.json missing project_id');
      }

      if (!credentials.private_key) {
        console.warn('⚠️ credentials.json missing private_key');
      }

      this.client = new vision.ImageAnnotatorClient({
        keyFilename: this.credentialsPath
      });

      this.enabled = true;
      console.log('✅ Google Vision client initialized');
      console.log('📋 Project ID:', credentials.project_id);

    } catch (error) {
      console.error('⚠️ Google Vision initialization failed:', error.message);
      this.client = null;
      this.enabled = false;
    }
  }

  /**
   * Prepare and validate image for Vision API
   */
  async prepareImageForVision(base64String, imageName = 'unknown') {
    try {
      console.log(`\n🖼️  Preparing image: ${imageName}`);

      if (!base64String || typeof base64String !== 'string') {
        throw new Error('No image data provided');
      }

      // Clean input
      let cleaned = base64String.trim();
      console.log(`   Original length: ${cleaned.length} chars`);

      // Extract base64 from data URL
      let base64Data = cleaned;
      if (cleaned.startsWith('data:image/')) {
        console.log('   Processing as data URL...');
        const matches = cleaned.match(/^data:image\/(jpeg|jpg|png|gif|bmp);base64,(.+)$/i);
        if (matches && matches.length === 3) {
          const imageType = matches[1].toLowerCase();
          base64Data = matches[2];
          console.log(`   Image type: ${imageType}`);
        } else {
          throw new Error('Invalid data URL format. Must be image/jpeg, image/png, etc.');
        }
      }

      // Remove any whitespace from base64
      base64Data = base64Data.replace(/\s/g, '');

      // Validate base64 format
      if (base64Data.length % 4 !== 0) {
        console.log('   Base64 length not multiple of 4, adding padding...');
        base64Data = this.fixBase64Padding(base64Data);
      }

      // Validate base64 characters
      if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
        throw new Error('Invalid characters in base64 string');
      }

      console.log(`   Cleaned base64 length: ${base64Data.length} chars`);

      // Convert to buffer and validate
      const buffer = Buffer.from(base64Data, 'base64');
      const sizeInMB = buffer.length / (1024 * 1024);
      console.log(`   Buffer size: ${buffer.length} bytes (${sizeInMB.toFixed(2)}MB)`);

      // Check if buffer is valid
      if (buffer.length === 0) {
        throw new Error('Empty image data');
      }

      // Check for common image signatures
      const signature = buffer.slice(0, 4).toString('hex').toUpperCase();
      console.log(`   File signature: 0x${signature}`);

      const isJPEG = buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xD8;
      const isPNG = buffer.length >= 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a';

      if (!isJPEG && !isPNG) {
        console.warn('   ⚠️  Warning: Not a standard JPEG or PNG file');
        // Try to save for debugging
        await this.saveDebugImage(buffer, `${imageName}-invalid-signature`);
      }

      // Check size limits
      if (buffer.length > this.MAX_IMAGE_SIZE) {
        console.log(`   ⚠️  Image too large (${sizeInMB.toFixed(2)}MB > ${this.MAX_IMAGE_SIZE / (1024 * 1024)}MB), compressing...`);
        return await this.compressImage(buffer);
      }

      // If image is large but acceptable, still optimize
      if (buffer.length > this.RECOMMENDED_SIZE) {
        console.log(`   📦 Image larger than recommended (${sizeInMB.toFixed(2)}MB), optimizing...`);
        return await this.optimizeImage(buffer);
      }

      console.log(`   ✅ Image ready for Vision API`);
      return base64Data;

    } catch (error) {
      console.error(`   ❌ Image preparation failed for ${imageName}:`, error.message);

      // Generate hash for debugging
      const hash = crypto.createHash('md5').update(base64String?.substring(0, 100) || '').digest('hex');
      console.error(`   🔍 Image hash (first 100 chars): ${hash}`);

      throw new Error(`Image preparation failed: ${error.message}`);
    }
  }

  /**
   * Fix base64 padding
   */
  fixBase64Padding(base64String) {
    let padded = base64String;
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    return padded;
  }

  /**
   * Compress image that's too large
   */
  async compressImage(buffer) {
    try {
      console.log('   🔧 Compressing image...');

      // Try using sharp if available (better performance)
      try {
        const sharp = require('sharp');
        const metadata = await sharp(buffer).metadata();
        console.log(`   📐 Original dimensions: ${metadata.width}x${metadata.height}`);

        // Calculate new dimensions
        let newWidth = metadata.width;
        let newHeight = metadata.height;

        if (metadata.width > this.MAX_DIMENSION || metadata.height > this.MAX_DIMENSION) {
          const scale = this.MAX_DIMENSION / Math.max(metadata.width, metadata.height);
          newWidth = Math.round(metadata.width * scale);
          newHeight = Math.round(metadata.height * scale);
          console.log(`   📏 Resizing to: ${newWidth}x${newHeight}`);
        }

        // Compress with sharp
        const compressedBuffer = await sharp(buffer)
          .resize(newWidth, newHeight, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({
            quality: this.JPEG_QUALITY,
            mozjpeg: true
          })
          .toBuffer();

        const compressedSize = compressedBuffer.length / (1024 * 1024);
        console.log(`   ✅ Compressed to: ${compressedSize.toFixed(2)}MB`);

        return compressedBuffer.toString('base64');

      } catch (sharpError) {
        console.log('   ⚠️  Sharp not available, falling back to Jimp...');
        // Fallback to Jimp
        return await this.compressWithJimp(buffer);
      }

    } catch (error) {
      console.error('   ❌ Compression failed:', error.message);
      throw new Error(`Image compression failed: ${error.message}`);
    }
  }

  /**
   * Compress using Jimp (fallback)
   */
  async compressWithJimp(buffer) {
    try {
      const Jimp = require('jimp');

      const image = await Jimp.read(buffer);
      console.log(`   📐 Original dimensions: ${image.bitmap.width}x${image.bitmap.height}`);

      // Resize if needed
      if (image.bitmap.width > this.MAX_DIMENSION || image.bitmap.height > this.MAX_DIMENSION) {
        image.scaleToFit(this.MAX_DIMENSION, this.MAX_DIMENSION);
        console.log(`   📏 Resized to: ${image.bitmap.width}x${image.bitmap.height}`);
      }

      // Set quality
      image.quality(this.JPEG_QUALITY);

      // Get compressed buffer
      const compressedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
      const compressedSize = compressedBuffer.length / (1024 * 1024);
      console.log(`   ✅ Compressed with Jimp to: ${compressedSize.toFixed(2)}MB`);

      return compressedBuffer.toString('base64');

    } catch (error) {
      console.error('   ❌ Jimp compression failed:', error.message);
      throw error;
    }
  }

  /**
   * Optimize image without resizing
   */
  async optimizeImage(buffer) {
    try {
      console.log('   ⚡ Optimizing image...');

      try {
        const sharp = require('sharp');
        const compressedBuffer = await sharp(buffer)
          .jpeg({
            quality: 85,
            mozjpeg: true
          })
          .toBuffer();

        const optimizedSize = compressedBuffer.length / (1024 * 1024);
        console.log(`   ✅ Optimized to: ${optimizedSize.toFixed(2)}MB`);

        return compressedBuffer.toString('base64');

      } catch (sharpError) {
        // Fallback to simple base64 return
        console.log('   ⚠️  Using original image (optimization skipped)');
        return buffer.toString('base64');
      }

    } catch (error) {
      console.error('   ❌ Optimization failed:', error.message);
      // Return original if optimization fails
      return buffer.toString('base64');
    }
  }

  /**
   * Save image for debugging
   */
  async saveDebugImage(buffer, name) {
    try {
      const debugDir = path.join(__dirname, '../debug-images');
      await fs.mkdir(debugDir, { recursive: true });

      const filename = `${name}-${Date.now()}.jpg`;
      const filepath = path.join(debugDir, filename);

      await fs.writeFile(filepath, buffer);
      console.log(`   💾 Debug image saved to: ${filepath}`);
    } catch (error) {
      console.error('   ❌ Failed to save debug image:', error.message);
    }
  }

  /**
 * Detect faces in an image
 */
  async detectFaces(imageBase64) {
    try {
      console.log('\n🔍 Starting face detection...');

      if (!this.enabled || !this.client) {
        return {
          success: false,
          message: 'Google Vision is not configured on this server. Face recognition is unavailable.',
          code: 'VISION_NOT_CONFIGURED'
        };
      }

      const processedImage = await this.prepareImageForVision(imageBase64, 'detect-faces');

      console.log('   📡 Calling Vision API...');
      const startTime = Date.now();

      // CORRECTED: Use annotateImage instead of faceDetection with features
      const [result] = await this.client.annotateImage({
        image: { content: processedImage },
        features: [{ type: 'FACE_DETECTION' }]
      });

      const elapsedTime = Date.now() - startTime;
      console.log(`   ⏱️  Vision API response time: ${elapsedTime}ms`);

      const faces = result.faceAnnotations;
      console.log(`   👥 Faces detected: ${faces?.length || 0}`);

      // Log all faces for debugging
      if (faces && faces.length > 0) {
        faces.forEach((face, index) => {
          console.log(`   👤 Face ${index + 1}: confidence ${face.detectionConfidence.toFixed(3)}`);
        });
      }

      if (!faces || faces.length === 0) {
        return {
          success: false,
          message: 'No faces detected in image'
        };
      }

      if (faces.length > 1) {
        return {
          success: false,
          message: 'Multiple faces detected. Please provide image with single face',
          facesCount: faces.length
        };
      }

      const face = faces[0];
      const faceData = this.extractFaceFeatures(face);

      console.log(`   ✅ Face detection confidence: ${face.detectionConfidence.toFixed(3)}`);

      return {
        success: true,
        face: faceData,
        confidence: face.detectionConfidence,
        boundingBox: face.boundingPoly,
        landmarks: face.landmarks?.length || 0,
      };
    } catch (error) {
      console.error('❌ Face detection error:', error.message);

      let userMessage = error.message;
      if (error.message.includes('No image present')) {
        userMessage = 'Invalid image data. The image may be corrupted or in an unsupported format.';
      } else if (error.message.includes('credentials')) {
        userMessage = 'Google Vision API authentication failed. Please check credentials.';
      } else if (error.message.includes('timeout')) {
        userMessage = 'Request to Google Vision API timed out. Please try again.';
      }

      return {
        success: false,
        message: userMessage,
        error: error.message
      };
    }
  }

  /**
 * Compare two faces using Vision API
 */
  async compareFaces(image1Base64, image2Base64) {
    try {
      console.log('\n🔄 Starting face comparison...');

      if (!this.enabled || !this.client) {
        return {
          success: false,
          message: 'Google Vision is not configured on this server. Face comparison is unavailable.',
          code: 'VISION_NOT_CONFIGURED'
        };
      }

      // Prepare both images
      const [processedImage1, processedImage2] = await Promise.all([
        this.prepareImageForVision(image1Base64, 'compare-1'),
        this.prepareImageForVision(image2Base64, 'compare-2')
      ]);

      console.log('   📡 Calling Vision API for both images...');
      const startTime = Date.now();

      // CORRECTED: Use proper API call format
      const requests = [
        {
          image: { content: processedImage1 },
          features: [{ type: 'FACE_DETECTION', maxResults: 10 }]
        },
        {
          image: { content: processedImage2 },
          features: [{ type: 'FACE_DETECTION', maxResults: 10 }]
        }
      ];

      // Use batchAnnotateImages instead of individual faceDetection calls
      const [result] = await this.client.batchAnnotateImages({ requests });

      const elapsedTime = Date.now() - startTime;
      console.log(`   ⏱️  Vision API total time: ${elapsedTime}ms`);

      // Extract responses
      const response1 = result.responses[0];
      const response2 = result.responses[1];

      // Check for errors
      if (response1.error) {
        console.error('   ❌ Image 1 error:', response1.error.message);
      }
      if (response2.error) {
        console.error('   ❌ Image 2 error:', response2.error.message);
      }

      const face1 = response1?.faceAnnotations?.[0];
      const face2 = response2?.faceAnnotations?.[0];

      console.log(`   👤 Face 1 detected: ${!!face1}, confidence: ${face1?.detectionConfidence?.toFixed(3) || 'N/A'}`);
      console.log(`   👤 Face 2 detected: ${!!face2}, confidence: ${face2?.detectionConfidence?.toFixed(3) || 'N/A'}`);

      // Log all detected faces for debugging
      console.log(`   📊 Total faces in image 1: ${response1?.faceAnnotations?.length || 0}`);
      console.log(`   📊 Total faces in image 2: ${response2?.faceAnnotations?.length || 0}`);

      // If no faces detected, try alternative approach
      if (!face1 || !face2) {
        // Try using lower confidence threshold
        let alternativeFace1 = null;
        let alternativeFace2 = null;

        if (response1?.faceAnnotations && response1.faceAnnotations.length > 0) {
          // Find face with best confidence
          alternativeFace1 = response1.faceAnnotations.reduce((best, current) =>
            (current.detectionConfidence > (best?.detectionConfidence || 0)) ? current : best
          );
        }

        if (response2?.faceAnnotations && response2.faceAnnotations.length > 0) {
          alternativeFace2 = response2.faceAnnotations.reduce((best, current) =>
            (current.detectionConfidence > (best?.detectionConfidence || 0)) ? current : best
          );
        }

        // If we found faces with lower confidence, log them
        if (alternativeFace1) {
          console.log(`   ⚠️  Alternative face 1 found with confidence: ${alternativeFace1.detectionConfidence.toFixed(3)}`);
        }
        if (alternativeFace2) {
          console.log(`   ⚠️  Alternative face 2 found with confidence: ${alternativeFace2.detectionConfidence.toFixed(3)}`);
        }

        // Use alternative faces if available
        if (alternativeFace1 && alternativeFace2) {
          face1 = alternativeFace1;
          face2 = alternativeFace2;
          console.log('   ✅ Using alternative faces with lower confidence');
        }
      }

      // Final check
      if (!face1 || !face2) {
        return {
          success: false,
          message: 'Could not detect faces in one or both images',
          face1Detected: !!face1,
          face2Detected: !!face2,
          details: {
            image1Faces: response1?.faceAnnotations?.length || 0,
            image2Faces: response2?.faceAnnotations?.length || 0,
            errors: {
              image1: response1?.error,
              image2: response2?.error
            }
          },
          suggestions: this.getFaceDetectionSuggestions()
        };
      }

      // Calculate similarity
      const similarity = this.calculateFaceSimilarity(face1, face2);
      const confidence = Math.min(face1.detectionConfidence, face2.detectionConfidence);

      // Adjusted thresholds for better matching
      const matched = similarity > 0.6 && confidence > 0.3;

      console.log(`   📊 Similarity score: ${similarity.toFixed(3)}`);
      console.log(`   🎯 Combined confidence: ${confidence.toFixed(3)}`);
      console.log(`   ✅ Match result: ${matched ? 'MATCH' : 'NO MATCH'}`);

      return {
        success: true,
        similarity: similarity,
        confidence: confidence,
        matched: matched,
        face1: this.extractFaceFeatures(face1),
        face2: this.extractFaceFeatures(face2),
        detectionConfidence: {
          face1: face1.detectionConfidence,
          face2: face2.detectionConfidence
        },
        processingTime: elapsedTime
      };
    } catch (error) {
      console.error('❌ Face comparison error:', error.message);
      console.error('Stack trace:', error.stack);

      let userMessage = 'Face comparison failed';
      let suggestion = 'Please try with clearer images';

      if (error.message.includes('No image present')) {
        userMessage = 'Image data appears to be corrupted.';
        suggestion = 'Ensure images are valid JPEG or PNG files';
      } else if (error.message.includes('credentials') || error.message.includes('auth')) {
        userMessage = 'Authentication with Google Vision API failed.';
        suggestion = 'Please check your Google Cloud credentials';
      } else if (error.message.includes('timeout') || error.message.includes('deadline')) {
        userMessage = 'Request to Google Vision API timed out.';
        suggestion = 'The images might be too large. Try smaller images';
      }

      return {
        success: false,
        message: userMessage,
        suggestion: suggestion,
        error: error.message,
        code: error.code
      };
    }
  }

  /**
   * Get suggestions for face detection
   */
  getFaceDetectionSuggestions() {
    return [
      'Use clear, front-facing photos with good lighting',
      'Avoid sunglasses, hats, or face coverings',
      'Ensure the face takes up a significant portion of the image',
      'Avoid extreme angles or profile shots',
      'Try images with neutral expressions',
      'Make sure the face is in focus and not blurry',
      'Avoid group photos - use single person images'
    ];
  }

  /**
   * Alternative: Use single image annotation for debugging
   */
  async testFaceDetection(imageBase64) {
    try {
      console.log('\n🔍 Testing face detection on single image...');

      const processedImage = await this.prepareImageForVision(imageBase64, 'test-detection');

      const request = {
        image: { content: processedImage },
        features: [{ type: 'FACE_DETECTION', maxResults: 10 }]
      };

      const [result] = await this.client.annotateImage(request);

      console.log('Face detection result:', {
        faces: result.faceAnnotations?.length || 0,
        confidence: result.faceAnnotations?.[0]?.detectionConfidence || 'N/A',
        errors: result.error
      });

      return result;
    } catch (error) {
      console.error('Single image test failed:', error);
      throw error;
    }
  }

  /**
   * Extract face features from Vision API response
   */
  extractFaceFeatures(face) {
    if (!face) return null;

    const features = {
      // Landmarks
      landmarks: {
        leftEye: this.getLandmark(face, 'LEFT_EYE'),
        rightEye: this.getLandmark(face, 'RIGHT_EYE'),
        leftEar: this.getLandmark(face, 'LEFT_EAR'),
        rightEar: this.getLandmark(face, 'RIGHT_EAR'),
        nose: this.getLandmark(face, 'NOSE_TIP'),
        mouthLeft: this.getLandmark(face, 'MOUTH_LEFT'),
        mouthRight: this.getLandmark(face, 'MOUTH_RIGHT'),
        chin: this.getLandmark(face, 'CHIN'),
      },

      // Headwear probability
      headwearLikelihood: face.headwearLikelihood,

      // Emotions
      emotions: {
        joy: face.joyLikelihood,
        sorrow: face.sorrowLikelihood,
        anger: face.angerLikelihood,
        surprise: face.surpriseLikelihood,
      },

      // Image quality
      quality: {
        blurred: face.blurredLikelihood,
        underexposed: face.underExposedLikelihood,
      },

      // Face angles
      angles: {
        roll: face.rollAngle,
        pan: face.panAngle,
        tilt: face.tiltAngle,
      },

      // Confidence scores
      confidence: {
        detection: face.detectionConfidence,
        landmark: face.landmarkingConfidence,
      },

      // Face bounds
      bounds: {
        vertices: face.boundingPoly?.vertices || []
      },

      // Additional metadata
      metadata: {
        landmarkCount: face.landmarks?.length || 0,
        isProfile: Math.abs(face.panAngle) > 30
      }
    };

    return features;
  }

  /**
   * Get specific landmark from face
   */
  getLandmark(face, type) {
    if (!face.landmarks || !Array.isArray(face.landmarks)) {
      return null;
    }

    const landmark = face.landmarks.find(l => l.type === type);
    return landmark ? {
      x: landmark.position.x,
      y: landmark.position.y,
      z: landmark.position.z,
    } : null;
  }

  /**
   * Calculate similarity between two faces
   */
  calculateFaceSimilarity(face1, face2) {
    if (!face1 || !face2) return 0;

    let score = 0;
    const weights = {
      rollAngle: 0.1,
      panAngle: 0.1,
      tiltAngle: 0.1,
      boundingBox: 0.15,
      landmarks: 0.55,
    };

    // Compare angles (normalize to 0-1)
    const angleDiff = Math.abs(face1.rollAngle - face2.rollAngle) / 180;
    const panDiff = Math.abs(face1.panAngle - face2.panAngle) / 180;
    const tiltDiff = Math.abs(face1.tiltAngle - face2.tiltAngle) / 180;

    score += (1 - angleDiff) * weights.rollAngle;
    score += (1 - panDiff) * weights.panAngle;
    score += (1 - tiltDiff) * weights.tiltAngle;

    // Compare bounding box aspect ratio
    const box1 = face1.boundingPoly?.vertices;
    const box2 = face2.boundingPoly?.vertices;

    if (box1 && box2 && box1.length >= 2 && box2.length >= 2) {
      const width1 = Math.abs(box1[1].x - box1[0].x) || 1;
      const height1 = Math.abs(box1[2].y - box1[0].y) || 1;
      const aspect1 = width1 / height1;

      const width2 = Math.abs(box2[1].x - box2[0].x) || 1;
      const height2 = Math.abs(box2[2].y - box2[0].y) || 1;
      const aspect2 = width2 / height2;

      const aspectDiff = Math.abs(aspect1 - aspect2) / Math.max(aspect1, aspect2);
      score += (1 - aspectDiff) * weights.boundingBox;
    }

    // Compare landmark positions (if available)
    if (face1.landmarks && face2.landmarks) {
      const landmarkScore = this.compareLandmarks(face1.landmarks, face2.landmarks);
      score += landmarkScore * weights.landmarks;
    }

    // Normalize to 0-1
    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Compare landmarks between two faces
   */
  compareLandmarks(landmarks1, landmarks2) {
    if (!landmarks1 || !landmarks2) return 0;

    const importantLandmarks = [
      'LEFT_EYE',
      'RIGHT_EYE',
      'NOSE_TIP',
      'MOUTH_LEFT',
      'MOUTH_RIGHT',
      'CHIN'
    ];

    let totalScore = 0;
    let matchedLandmarks = 0;

    for (const landmarkType of importantLandmarks) {
      const lm1 = landmarks1.find(l => l.type === landmarkType);
      const lm2 = landmarks2.find(l => l.type === landmarkType);

      if (lm1 && lm2) {
        // Calculate normalized Euclidean distance
        const dx = lm1.position.x - lm2.position.x;
        const dy = lm1.position.y - lm2.position.y;
        const dz = lm1.position.z - lm2.position.z;

        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Normalize distance to 0-1 score
        // Assuming max normalized distance of 100 (can be adjusted)
        const maxDistance = 100;
        const landmarkScore = Math.max(0, 1 - (distance / maxDistance));

        totalScore += landmarkScore;
        matchedLandmarks++;
      }
    }

    return matchedLandmarks > 0 ? totalScore / matchedLandmarks : 0;
  }

  /**
   * Validate if image can be processed
   */
  async validateImage(imageBase64) {
    try {
      console.log('\n✅ Validating image...');

      const result = await this.detectFaces(imageBase64);

      return {
        valid: result.success,
        message: result.message,
        details: result.success ? {
          hasFace: true,
          confidence: result.confidence,
          singleFace: true,
          imageQuality: result.face?.quality
        } : {
          hasFace: false,
          reason: result.message
        }
      };
    } catch (error) {
      console.error('Image validation error:', error.message);
      return {
        valid: false,
        message: error.message,
        error: error.message.includes('No image present')
          ? 'Invalid image data. Please check image format.'
          : 'Image validation failed'
      };
    }
  }

  /**
   * Batch process multiple images
   */
  async batchProcessImages(imagesBase64) {
    try {
      console.log(`\n📦 Batch processing ${imagesBase64.length} images...`);

      const results = [];
      const errors = [];

      for (let i = 0; i < imagesBase64.length; i++) {
        try {
          console.log(`   Processing image ${i + 1}/${imagesBase64.length}...`);
          const result = await this.detectFaces(imagesBase64[i]);
          results.push({
            index: i,
            success: result.success,
            ...result
          });
        } catch (error) {
          errors.push({
            index: i,
            error: error.message
          });
        }
      }

      return {
        success: errors.length === 0,
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors
      };
    } catch (error) {
      console.error('Batch processing error:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const googleVisionService = new GoogleVisionService();
module.exports = googleVisionService;