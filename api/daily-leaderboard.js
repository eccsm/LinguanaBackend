/**
 * Daily Leaderboard API
 * Returns today's global leaderboard for daily challenge
 */

const { getFirestore } = require('firebase-admin/firestore');

module.exports = async (req, res) => {
  try {
    const { date, language = 'es', limit = 100 } = req.query;

    const db = getFirestore();
    const today = date || new Date().toISOString().split('T')[0];

    console.log(`[DAILY-LEADERBOARD] Fetching for date: ${today}, language: ${language}`);

    // Query Firestore for today's scores
    const scoresRef = db.collection('dailyChallengeScores');
    const query = scoresRef
      .where('date', '==', today)
      .where('language', '==', language)
      .orderBy('score', 'desc')
      .orderBy('completionTime', 'asc') // Tie-breaker: faster wins
      .limit(parseInt(limit));

    const snapshot = await query.get();

    const leaderboard = [];
    let rank = 1;

    snapshot.forEach(doc => {
      const data = doc.data();
      leaderboard.push({
        rank,
        userId: data.userId,
        displayName: data.displayName || 'Anonymous',
        score: data.score,
        maxScore: data.maxScore,
        percentage: Math.round((data.score / data.maxScore) * 100),
        completionTime: data.completionTime, // seconds
        lives: data.lives || 3,
        streak: data.streak || 1,
        timestamp: data.timestamp,
      });
      rank++;
    });

    // Get stats
    const stats = {
      totalParticipants: leaderboard.length,
      averageScore: leaderboard.length > 0 
        ? Math.round(leaderboard.reduce((sum, entry) => sum + entry.score, 0) / leaderboard.length)
        : 0,
      highestScore: leaderboard[0]?.score || 0,
    };

    res.status(200).json({
      success: true,
      date: today,
      language,
      leaderboard,
      stats,
    });

  } catch (error) {
    console.error('[DAILY-LEADERBOARD] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leaderboard',
      details: error.message,
    });
  }
};
