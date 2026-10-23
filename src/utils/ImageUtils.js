// utils/imageUtils.js
class ImageUtils {
  /**
   * Ensure image has proper data URL format
   */
  static formatImageData(imageBase64) {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new Error('Invalid image data');
    }

    // If already has data URL format, return as-is
    if (imageBase64.startsWith('data:image/')) {
      return imageBase64;
    }

    // Try to detect image type from base64 pattern
    let mimeType = 'image/jpeg'; // default
    
    if (imageBase64.startsWith('/9j/') || imageBase64.includes('/9j/')) {
      mimeType = 'image/jpeg';
    } else if (imageBase64.startsWith('iVBORw0KGgo')) {
      mimeType = 'image/png';
    } else if (imageBase64.startsWith('R0lGOD')) {
      mimeType = 'image/gif';
    } else if (imageBase64.startsWith('UklGR')) {
      mimeType = 'image/webp';
    }
    
    return `data:${mimeType};base64,${imageBase64}`;
  }

  /**
   * Validate if string is a valid base64 image
   */
  static isValidBase64Image(imageBase64) {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return false;
    }

    // Check if it's a data URL
    if (imageBase64.startsWith('data:image/')) {
      const matches = imageBase64.match(/^data:image\/\w+;base64,(.+)$/);
      if (!matches || matches.length !== 2) {
        return false;
      }
      const base64Data = matches[1];
      // Validate base64 format
      return /^[A-Za-z0-9+/]+={0,2}$/.test(base64Data);
    } else {
      // Assume it's pure base64
      return /^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64);
    }
  }

  /**
   * Extract pure base64 data from data URL
   */
  static extractBase64Data(imageBase64) {
    if (!imageBase64) return null;
    
    if (imageBase64.startsWith('data:image/')) {
      const matches = imageBase64.match(/^data:image\/\w+;base64,(.+)$/);
      return matches ? matches[1] : imageBase64;
    }
    
    return imageBase64;
  }
}

module.exports = ImageUtils;