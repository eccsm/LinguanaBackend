/**
 * Submit Daily Challenge Score API
 * Saves user's daily challenge score and updates streaks
 */

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

module.exports = async (req, res) => {
  try {
    const {
      userId,
      displayName,
      date,
      language,
      score,
      maxScore,
      completionTime, // in seconds
      lives, // remaining lives (0-3)
      correctAnswers,
      wrongAnswers,
    } = req.body;

    // Validation
    if (!userId || score === undefined || !maxScore) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, score, maxScore',
      });
    }

    const db = getFirestore();
    const today = date || new Date().toISOString().split('T')[0];

    console.log(`[SUBMIT-SCORE] User: ${userId}, Score: ${score}/${maxScore}, Date: ${today}`);

    // Check if user already submitted for today
    const existingScoreQuery = await db.collection('dailyChallengeScores')
      .where('userId', '==', userId)
      .where('date', '==', today)
      .where('language', '==', language)
      .get();

    let docRef;
    let isNewSubmission = existingScoreQuery.empty;

    if (!isNewSubmission) {
      // Update existing score only if better
      const existingDoc = existingScoreQuery.docs[0];
      const existingData = existingDoc.data();

      if (score > existingData.score) {
        console.log(`[SUBMIT-SCORE] Updating better score: ${score} > ${existingData.score}`);
        await existingDoc.ref.update({
          score,
          completionTime,
          lives,
          correctAnswers,
          wrongAnswers,
          timestamp: FieldValue.serverTimestamp(),
        });
        docRef = existingDoc.ref;
      } else {
        console.log(`[SUBMIT-SCORE] Keeping existing better score: ${existingData.score} >= ${score}`);
        return res.status(200).json({
          success: true,
          message: 'Score submitted but not improved',
          currentScore: existingData.score,
          newScore: score,
        });
      }
    } else {
      // Create new score entry
      docRef = await db.collection('dailyChallengeScores').add({
        userId,
        displayName: displayName || 'Anonymous',
        date: today,
        language,
        score,
        maxScore,
        completionTime,
        lives,
        correctAnswers,
        wrongAnswers,
        timestamp: FieldValue.serverTimestamp(),
      });
      console.log(`[SUBMIT-SCORE] New score submitted: ${docRef.id}`);
    }

    // Update user's streak
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const userData = userDoc.data();
      const lastPlayedDate = userData.lastDailyChallengeDate;
      const currentStreak = userData.dailyChallengeStreak || 0;
      const longestStreak = userData.longestDailyChallengeStreak || 0;

      let newStreak = 1;

      if (lastPlayedDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (lastPlayedDate === yesterdayStr) {
          // Consecutive day - increment streak
          newStreak = currentStreak + 1;
        } else if (lastPlayedDate === today) {
          // Same day - keep streak
          newStreak = currentStreak;
        }
        // else: streak broken, newStreak = 1
      }

      const newLongestStreak = Math.max(newStreak, longestStreak);

      await userRef.update({
        lastDailyChallengeDate: today,
        dailyChallengeStreak: newStreak,
        longestDailyChallengeStreak: newLongestStreak,
        totalDailyChallengesCompleted: FieldValue.increment(isNewSubmission ? 1 : 0),
      });

      console.log(`[SUBMIT-SCORE] Updated streak: ${newStreak}, longest: ${newLongestStreak}`);

      // Award streak bonus points or rewards
      let streakBonus = null;
      if (newStreak >= 7) {
        streakBonus = {
          type: 'weekly_streak',
          reward: '🔥 7-day streak! Keep going!',
        };
      } else if (newStreak >= 3) {
        streakBonus = {
          type: '3_day_streak',
          reward: '⭐ 3-day streak!',
        };
      }

      res.status(200).json({
        success: true,
        message: 'Score submitted successfully',
        score: {
          current: score,
          max: maxScore,
          percentage: Math.round((score / maxScore) * 100),
        },
        streak: {
          current: newStreak,
          longest: newLongestStreak,
          bonus: streakBonus,
        },
      });
    } else {
      res.status(200).json({
        success: true,
        message: 'Score submitted successfully',
        score: {
          current: score,
          max: maxScore,
          percentage: Math.round((score / maxScore) * 100),
        },
      });
    }

  } catch (error) {
    console.error('[SUBMIT-SCORE] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit score',
      details: error.message,
    });
  }
};
