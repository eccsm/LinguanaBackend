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
    // Use lastPracticeDate to match DB field name
    const lastPractice = data.lastPracticeDate ? data.lastPracticeDate.toDate() : new Date(0);
    const today = new Date();

    // Normalize to midnight for accurate day comparison
    const lastDate = new Date(lastPractice.setHours(0, 0, 0, 0));
    const currDate = new Date(today.setHours(0, 0, 0, 0));

    const diffTime = Math.abs(currDate - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let newStreak = data.currentStreak || 0;

    if (diffDays === 1) {
      // Continued streak
      newStreak += 1;
    } else if (diffDays > 1) {
      // Streak broken - check for active streak freeze buff first
      const buffs = data.activeBuffs || {};
      const freezeUntil = buffs.streakFreezeUntil ? buffs.streakFreezeUntil.toDate() : null;

      if (freezeUntil && freezeUntil > new Date()) {
        // Streak freeze is active - don't break streak
        console.log('[STREAK] Streak freeze active, preserving streak');
      } else if (data.inventory && data.inventory.streakFreeze > 0) {
        // Legacy: auto-consume streak freeze from inventory
        t.update(userRef, { 'inventory.streakFreeze': admin.firestore.FieldValue.increment(-1) });
        console.log('[STREAK] Auto-consumed streak freeze from inventory');
      } else {
        // Save previousStreak before resetting
        if (data.currentStreak > 1) {
          t.update(userRef, { previousStreak: data.currentStreak });
        }
        newStreak = 1; // Reset
      }
    }
    // If diffDays === 0, they already logged in today, do nothing.

    t.update(userRef, {
      currentStreak: newStreak,
      lastPracticeDate: admin.firestore.FieldValue.serverTimestamp(),
      longestStreak: Math.max(newStreak, data.longestStreak || 0)
    });
  });
};

/**
 * 3. PROCESS REVIEW SESSION
 * API Endpoint logic to handle a batch of reviewed cards.
 */
const processReviewBatch = async (userId, reviews) => {
  console.log('[VOCAB_BACKEND] 📥 Processing review batch:', {
    userId,
    reviewCount: reviews.length,
    reviews: reviews.map(r => ({ wordId: r.wordId, quality: r.quality }))
  });

  try {
    // Fetch all card documents first
    console.log('[VOCAB_BACKEND] 🔍 Fetching card data from Firestore...');
    const cardPromises = reviews.map(review => {
      const cardRef = db.collection('users').doc(userId).collection('vocabDeck').doc(review.wordId);
      return cardRef.get().then(doc => ({ review, doc, cardRef }));
    });

    const cardData = await Promise.all(cardPromises);
    console.log('[VOCAB_BACKEND] ✅ Card data fetched:', cardData.length, 'cards');

    // Process updates in a batch
    const batch = db.batch();

    cardData.forEach(({ review, doc, cardRef }, index) => {
      if (!doc.exists) {
        console.warn(`[VOCAB_BACKEND] ⚠️ Card ${review.wordId} not found for user ${userId}`);
        return;
      }

      const currentData = doc.data();
      const prevData = {
        interval: currentData.interval || 0,
        repetitions: currentData.repetitions || 0,
        easeFactor: currentData.easeFactor || 2.5
      };

      console.log(`[VOCAB_BACKEND] 📊 Card ${index + 1}/${cardData.length}:`, {
        wordId: review.wordId,
        front: currentData.front,
        quality: review.quality,
        prevInterval: prevData.interval,
        prevReps: prevData.repetitions,
        prevEase: prevData.easeFactor
      });

      // Calculate next review using SRS algorithm
      const srsUpdate = calculateNextReview(review.quality, prevData);

      console.log(`[VOCAB_BACKEND] 🔄 SRS calculation result:`, {
        newInterval: srsUpdate.interval,
        newReps: srsUpdate.repetitions,
        newEase: srsUpdate.easeFactor,
        nextReviewDate: srsUpdate.nextReviewDate.toISOString()
      });

      // Update the card with new SRS data
      batch.update(cardRef, {
        interval: srsUpdate.interval,
        repetitions: srsUpdate.repetitions,
        easeFactor: srsUpdate.easeFactor,
        nextReview: admin.firestore.Timestamp.fromDate(srsUpdate.nextReviewDate), // Changed from nextReviewDate to nextReview
        lastReviewed: admin.firestore.FieldValue.serverTimestamp(),
        totalReviews: admin.firestore.FieldValue.increment(1)
      });
    });

    console.log('[VOCAB_BACKEND] 💾 Committing batch update to Firestore...');
    await batch.commit();
    console.log(`[VOCAB_BACKEND] ✅ Batch committed: ${reviews.length} cards updated`);

    // Award XP for completing reviews (10 XP per card)
    // Check for active XP buff
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    let xpMultiplier = 1;
    const buffs = userData.activeBuffs || {};
    if (buffs.xpMultiplierUntil) {
      const expiresAt = buffs.xpMultiplierUntil.toDate();
      if (expiresAt > new Date()) {
        xpMultiplier = buffs.xpMultiplier || 2;
        console.log('[VOCAB_BACKEND] 🔥 XP Potion active! Multiplier:', xpMultiplier);
      }
    }

    const xpEarned = reviews.length * 10 * xpMultiplier;
    console.log(`[VOCAB_BACKEND] 🏆 Awarding XP:`, {
      userId,
      xpEarned,
      xpMultiplier,
      reviewsProcessed: reviews.length
    });

    await userRef.update({
      xp: admin.firestore.FieldValue.increment(xpEarned),
      totalReviews: admin.firestore.FieldValue.increment(reviews.length)
    });
    console.log(`[VOCAB_BACKEND] ✅ User stats updated: +${xpEarned} XP, +${reviews.length} total reviews`);

    return { success: true, reviewsProcessed: reviews.length, xpEarned };
  } catch (error) {
    console.error('[VOCAB_BACKEND] ❌ Error processing review batch:', {
      error: error.message,
      stack: error.stack,
      userId,
      reviewCount: reviews.length
    });
    throw error;
  }
};

/**
 * 4. GRANT SESSION REWARDS
 * Awards XP and Gems based on session type
 * Prevents duplicate rewards for the same session
 */
const grantSessionRewards = async (userId, type, sessionId) => {
  console.log('[REWARDS] 🎁 Granting session rewards:', {
    userId,
    type,
    sessionId
  });

  try {
    // Validate sessionId is provided
    if (!sessionId) {
      console.warn('[REWARDS] ⚠️ No sessionId provided - required to prevent duplicates');
      return {
        success: false,
        error: 'Session ID is required'
      };
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.warn('[REWARDS] ⚠️ User document not found:', userId);
      return {
        success: false,
        error: 'User not found'
      };
    }

    const userData = userDoc.data();
    const rewardedSessions = userData.rewardedSessions || [];

    // Check if this session was already rewarded
    if (rewardedSessions.includes(sessionId)) {
      console.warn('[REWARDS] ⚠️ Session already rewarded:', {
        userId,
        sessionId,
        type
      });
      return {
        success: false,
        error: 'Session already rewarded',
        alreadyRewarded: true
      };
    }

    // Define rewards based on session type
    // NOTE: Review sessions already award 10 XP per card in processReviewBatch
    // So we only award gems here to avoid double-counting XP
    const rewards = {
      review: {
        xp: 0,  // XP already awarded per card in processReviewBatch
        gems: 0,
        description: 'Vocabulary Review'
      },
      roleplay: {
        xp: 50,
        gems: 20,
        description: 'Roleplay Session'
      }
    };

    const reward = rewards[type];

    if (!reward) {
      console.warn('[REWARDS] ⚠️ Unknown session type:', type);
      return {
        success: false,
        error: 'Unknown session type'
      };
    }

    // Check for active XP buff
    let xpMultiplier = 1;
    const buffs = userData.activeBuffs || {};
    if (buffs.xpMultiplierUntil) {
      const expiresAt = buffs.xpMultiplierUntil.toDate();
      if (expiresAt > new Date()) {
        xpMultiplier = buffs.xpMultiplier || 2;
        console.log('[REWARDS] 🔥 XP Potion active! Multiplier:', xpMultiplier);
      }
    }

    const xpAmount = reward.xp * xpMultiplier;
    console.log('[REWARDS] 🏆 Awarding:', {
      xp: xpAmount,
      gems: reward.gems,
      xpMultiplier,
      sessionType: reward.description
    });

    // Update user's XP, Gems, and mark session as rewarded
    await userRef.update({
      xp: admin.firestore.FieldValue.increment(xpAmount),
      gems: admin.firestore.FieldValue.increment(reward.gems),
      rewardedSessions: admin.firestore.FieldValue.arrayUnion(sessionId)
    });

    console.log('[REWARDS] ✅ Rewards granted successfully:', {
      userId,
      sessionId,
      xpAwarded: reward.xp,
      gemsAwarded: reward.gems
    });

    return {
      success: true,
      xpAwarded: reward.xp,
      gemsAwarded: reward.gems,
      sessionType: reward.description,
      sessionId: sessionId
    };

  } catch (error) {
    console.error('[REWARDS] ❌ Error granting rewards:', {
      error: error.message,
      stack: error.stack,
      userId,
      type,
      sessionId
    });
    throw error;
  }
};

/**
 * 5. GRANT AD REWARD
 * Awards extra chats or interviews for watching ads
 * Enforces daily limits
 */
const grantAdReward = async (userId, rewardType = 'chat') => {
  console.log('[AD_REWARD] 📺 Granting ad reward:', { userId, rewardType });

  try {
    const userRef = db.collection('users').doc(userId);

    // Run in transaction to ensure atomic read-modify-write for limits
    return await db.runTransaction(async (t) => {
      const doc = await t.get(userRef);
      if (!doc.exists) throw new Error('User not found');

      const data = doc.data();
      const today = new Date().toDateString();

      // Get ad stats
      const adStats = data.adStats || {};
      const lastAdDate = adStats.lastAdDate ? adStats.lastAdDate.toDate().toDateString() : null;

      // Reset counts if new day
      let dailyChatAds = adStats.dailyChatAds || 0;
      let dailyInterviewAds = adStats.dailyInterviewAds || 0;

      if (lastAdDate !== today) {
        dailyChatAds = 0;
        dailyInterviewAds = 0;
      }

      // Define limits
      const LIMITS = {
        chat: 5,
        interview: 3
      };

      if (rewardType === 'chat') {
        if (dailyChatAds >= LIMITS.chat) {
          return { success: false, error: 'Daily chat ad limit reached', limitReached: true };
        }

        // Grant reward
        t.update(userRef, {
          extraChats: admin.firestore.FieldValue.increment(1),
          'adStats.dailyChatAds': dailyChatAds + 1,
          'adStats.lastAdDate': admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: 'Extra chat granted', newCount: dailyChatAds + 1 };

      } else if (rewardType === 'interview') {
        if (dailyInterviewAds >= LIMITS.interview) {
          return { success: false, error: 'Daily interview ad limit reached', limitReached: true };
        }

        // Grant reward
        t.update(userRef, {
          extraInterviews: admin.firestore.FieldValue.increment(1),
          'adStats.dailyInterviewAds': dailyInterviewAds + 1,
          'adStats.lastAdDate': admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: 'Extra interview granted', newCount: dailyInterviewAds + 1 };
      } else {
        return { success: false, error: 'Invalid reward type' };
      }
    });

  } catch (error) {
    console.error('[AD_REWARD] ❌ Error:', error);
    throw error;
  }
};

module.exports = {
  calculateNextReview,
  updateStreak,
  processReviewBatch,
  grantSessionRewards,
  grantAdReward
};