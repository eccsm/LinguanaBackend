// backend/services/gamification.js
const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const db = admin.firestore();

/**
 * ==========================================
 * CORE ALGORITHMS (Pure Functions)
 * ==========================================
 */

/**
 * 1. SRS ALGORITHM (SuperMemo-2 Simplified)
 * Calculates when a user should review a word again.
 * * @param {number} quality - 0-5 rating (0=blackout, 5=perfect)
 * @param {object} prevData - { interval: number, repetitions: number, easeFactor: number }
 * @returns {object} - { interval, repetitions, easeFactor, nextReviewDate }
 */
const calculateNextReview = (quality, prevData = {}) => {
  let { interval = 0, repetitions = 0, easeFactor = 2.5 } = prevData;

  // If quality is low (forgotten), reset reps
  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    // Calculate new ease factor
    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    repetitions += 1;

    // Calculate interval (days)
    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
  }

  // Calculate next date
  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return { interval, repetitions, easeFactor, nextReviewDate };
};

/**
 * ==========================================
 * SERVICE METHODS (Database Interactions)
 * ==========================================
 */

/**
 * 2. STREAK LOGIC
 * Updates user streak based on last activity.
 */
const updateStreak = async (userId) => {
  const userRef = db.collection('users').doc(userId);
  
  await db.runTransaction(async (t) => {
    const doc = await t.get(userRef);
    if (!doc.exists) return;

    const data = doc.data();
    const lastActive = data.lastActive ? data.lastActive.toDate() : new Date(0);
    const today = new Date();
    
    // Normalize to midnight for accurate day comparison
    const lastDate = new Date(lastActive.setHours(0,0,0,0));
    const currDate = new Date(today.setHours(0,0,0,0));
    
    const diffTime = Math.abs(currDate - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let newStreak = data.currentStreak || 0;

    if (diffDays === 1) {
      // Continued streak
      newStreak += 1;
    } else if (diffDays > 1) {
      // Streak broken (Check for Freeze item here in future)
      // If user has 'streakFreeze' > 0, decrement freeze and keep streak
      if (data.inventory && data.inventory.streakFreeze > 0) {
        t.update(userRef, { 'inventory.streakFreeze': admin.firestore.FieldValue.increment(-1) });
        // Streak saved, do not reset
      } else {
        newStreak = 1; // Reset
      }
    }
    // If diffDays === 0, they already logged in today, do nothing.

    t.update(userRef, {
      currentStreak: newStreak,
      lastActive: admin.firestore.FieldValue.serverTimestamp(),
      longestStreak: Math.max(newStreak, data.longestStreak || 0)
    });
  });
};

/**
 * 3. PROCESS REVIEW SESSION
 * API Endpoint logic to handle a batch of reviewed cards.
 */
const processReviewBatch = async (userId, reviews) => {
  // reviews = [{ wordId: "hola", quality: 4, prevData: {...} }, ...]
  // prevData can be passed from frontend or we fetch it here
  
  try {
    // Fetch all card documents first
    const cardPromises = reviews.map(review => {
      const cardRef = db.collection('users').doc(userId).collection('vocabDeck').doc(review.wordId);
      return cardRef.get().then(doc => ({ review, doc, cardRef }));
    });
    
    const cardData = await Promise.all(cardPromises);
    
    // Process updates in a batch
    const batch = db.batch();
    
    cardData.forEach(({ review, doc, cardRef }) => {
      if (!doc.exists) {
        console.warn(`Card ${review.wordId} not found for user ${userId}`);
        return;
      }
      
      const currentData = doc.data();
      const prevData = {
        interval: currentData.interval || 0,
        repetitions: currentData.repetitions || 0,
        easeFactor: currentData.easeFactor || 2.5
      };
      
      // Calculate next review using SRS algorithm
      const srsUpdate = calculateNextReview(review.quality, prevData);
      
      // Update the card with new SRS data
      batch.update(cardRef, {
        interval: srsUpdate.interval,
        repetitions: srsUpdate.repetitions,
        easeFactor: srsUpdate.easeFactor,
        nextReviewDate: admin.firestore.Timestamp.fromDate(srsUpdate.nextReviewDate),
        lastReviewed: admin.firestore.FieldValue.serverTimestamp(),
        totalReviews: admin.firestore.FieldValue.increment(1)
      });
    });
    
    await batch.commit();
    console.log(`✅ Processed ${reviews.length} reviews for user ${userId}`);
    
    return { success: true, reviewsProcessed: reviews.length };
  } catch (error) {
    console.error('❌ Error processing review batch:', error.message);
    throw error;
  }
};

module.exports = {
  calculateNextReview,
  updateStreak,
  processReviewBatch
};