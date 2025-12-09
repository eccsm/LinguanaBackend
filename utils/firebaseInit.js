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
        console.log('ℹ️ No explicit credentials found - attempting default initialization (Cloud Functions/GCP)');
        // Initialize with default credentials (works in Cloud Functions)
        admin.initializeApp();
      }

      isInitialized = true;
      console.log('✅ Firebase Admin initialized successfully');
    } else {
      isInitialized = true;
    }
  } catch (error) {
    // If we are in Cloud Functions, we might not need to throw if it's already initialized or if default creds work
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin already initialized');
      return admin;
    }
    console.error('❌ Firebase initialization error:', error.message);
    // Don't throw here, let it fail downstream if really broken, 
    // but often this catch triggers on local dev when it shouldn't.
    // For safety in this specific migration context:
    if (!process.env.FIREBASE_PROJECT_ID && !process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.warn('⚠️ Continue with potential default credentials...');
    } else {
      throw error;
    }
  }

  return admin;
};

module.exports = { initializeFirebase };
