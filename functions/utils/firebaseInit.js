const {
  cert,
  getApps,
  initializeApp,
} = require('firebase-admin/app');
const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

// Compatibility surface for the existing backend modules. This keeps calls
// such as admin.firestore() and admin.messaging() working while using the
// modular Firebase Admin SDK internally.
const firestore = () => getFirestore();
firestore.FieldValue = FieldValue;
firestore.Timestamp = Timestamp;

const admin = {
  firestore,
  auth: () => getAuth(),
  messaging: () => getMessaging(),
};

/**
 * Initialize Firebase Admin once and return the compatibility surface.
 */
const initializeFirebase = () => {
  if (getApps().length > 0) {
    return admin;
  }

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf-8')
      );

      initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
    } else if (process.env.FIREBASE_PROJECT_ID) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
    } else {
      console.log('No explicit credentials found - using Cloud Functions default credentials');
      initializeApp();
    }

    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    if (getApps().length === 0) {
      throw error;
    }
  }

  return admin;
};

module.exports = { initializeFirebase };
