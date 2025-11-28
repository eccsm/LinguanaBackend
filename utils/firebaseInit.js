const admin = require('firebase-admin');

let isInitialized = false;

/**
 * Initialize Firebase Admin SDK
 * This handles the initialization to avoid duplicate initialization errors
 */
const initializeFirebase = () => {
  if (isInitialized) {
    return admin;
  }

  try {
    // Check if Firebase is already initialized
    if (admin.apps.length === 0) {
      // In Vercel, use environment variables for Firebase config
      // You can use a service account JSON or individual config values
      
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Option 1: Using service account JSON (stored as base64 or JSON string)
        const serviceAccount = JSON.parse(
          Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8')
        );
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
      } else if (process.env.FIREBASE_PROJECT_ID) {
        // Option 2: Using individual environment variables
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
          }),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
      } else {
        console.warn('⚠️ Firebase credentials not found in environment variables');
        // Initialize with default credentials (works in some environments)
        admin.initializeApp();
      }
      
      isInitialized = true;
      console.log('✅ Firebase Admin initialized successfully');
    } else {
      isInitialized = true;
    }
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
    throw error;
  }

  return admin;
};

module.exports = { initializeFirebase };
