const { initializeFirebase } = require('./firebaseInit');

/**
 * Verify Firebase ID token and extract user ID
 * @param {string} token - Firebase ID token from Authorization header
 * @returns {Promise<string>} - User ID
 */
const verifyFirebaseToken = async (token) => {
  const admin = initializeFirebase();
  
  try {
    // Remove 'Bearer ' prefix if present
    const idToken = token.replace(/^Bearer\s+/i, '');
    
    // Verify the token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken.uid;
  } catch (error) {
    console.error('❌ Token verification error:', error.message);
    throw new Error('Invalid or expired token');
  }
};

/**
 * Extract user ID from request
 * Supports multiple authentication methods:
 * 1. Firebase ID token in Authorization header
 * 2. User ID in request body (less secure, for testing)
 * 
 * @param {object} req - Request object
 * @returns {Promise<string>} - User ID
 */
const extractUserId = async (req) => {
  // Method 1: Extract from Firebase token (most secure)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      const userId = await verifyFirebaseToken(authHeader);
      return userId;
    } catch (error) {
      throw new Error('Authentication failed: ' + error.message);
    }
  }
  
  // Method 2: Extract from request body (for testing/development)
  // In production, you should remove this or make it conditional
  if (req.body && req.body.userId) {
    console.warn('⚠️ Using userId from request body - not recommended for production');
    return req.body.userId;
  }
  
  throw new Error('No authentication credentials provided');
};

module.exports = {
  verifyFirebaseToken,
  extractUserId
};
