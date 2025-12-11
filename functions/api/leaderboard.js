const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const { FieldValue } = require('firebase-admin/firestore');

async function handleLeaderboard(req, res) {
    try {
        const { date, limit = 100 } = req.query;
        // Cap limit to 50 to prevent excessive reads
        const safeLimit = Math.min(parseInt(limit) || 50, 50);
        const db = admin.firestore();
        const today = date || new Date().toISOString().split('T')[0];

        // Add caching headers: 1 min client, 5 min CDN
        res.set('Cache-Control', 'public, max-age=60, s-maxage=300');

        const scoresRef = db.collection('dailyChallengeScores');
        const query = scoresRef
            .where('date', '==', today)
            .orderBy('score', 'desc')
            .orderBy('completionTime', 'asc')
            .limit(safeLimit);

        const snapshot = await query.get();

        const leaderboardData = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                userId: data.userId,
                displayName: data.displayName || 'Anonymous',
                username: data.username || null,
                score: data.score,
                maxScore: data.maxScore,
                percentage: Math.round((data.score / data.maxScore) * 100),
                completionTime: data.completionTime,
                correctAnswers: data.correctAnswers,
                wrongAnswers: data.wrongAnswers,
                usedAdContinue: data.usedAdContinue || false,
                completed: data.completed || false,
                avatar: data.avatar || null,
                timestamp: data.timestamp,
            };
        });

        const leaderboard = leaderboardData.map((entry, index) => ({
            rank: index + 1,
            ...entry
        }));

        const stats = {
            totalParticipants: leaderboard.length,
            averageScore: leaderboard.length > 0
                ? Math.round(leaderboard.reduce((sum, entry) => sum + entry.score, 0) / leaderboard.length)
                : 0,
            highestScore: leaderboard[0]?.score || 0,
        };

        res.status(200).json({ success: true, date: today, leaderboard, stats });
    } catch (error) {
        console.error('[DAILY-LEADERBOARD] Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch leaderboard', details: error.message });
    }
}

async function handleAwardWinner(req, res) {
    try {
        const { date } = req.query;
        const db = admin.firestore();

        const targetDate = date || (() => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return yesterday.toISOString().split('T')[0];
        })();

        const scoresRef = db.collection('dailyChallengeScores');
        const query = scoresRef
            .where('date', '==', targetDate)
            .orderBy('score', 'desc')
            .orderBy('completionTime', 'asc')
            .limit(1);

        const snapshot = await query.get();

        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: `No participants found for ${targetDate}` });
        }

        const winnerDoc = snapshot.docs[0];
        const winnerData = winnerDoc.data();
        const winnerId = winnerData.userId;

        if (winnerData.gemAwarded) {
            return res.status(200).json({
                success: true,
                message: 'Gems already awarded',
                winner: {
                    userId: winnerId,
                    displayName: winnerData.displayName,
                    score: winnerData.score,
                    alreadyAwarded: true
                }
            });
        }

        await db.runTransaction(async (transaction) => {
            const freshWinnerDoc = await transaction.get(winnerDoc.ref);
            if (!freshWinnerDoc.exists) {
                throw new Error("Winner document disappeared");
            }

            const freshWinnerData = freshWinnerDoc.data();
            if (freshWinnerData.gemAwarded) {
                return; // Already awarded, do nothing
            }

            transaction.update(userRef, { gems: FieldValue.increment(100) });
            transaction.update(winnerDoc.ref, {
                gemAwarded: true,
                gemAwardedAt: FieldValue.serverTimestamp()
            });
        });

        return res.status(200).json({
            success: true,
            message: 'Winner awarded 100 gems!',
            winner: {
                userId: winnerId,
                displayName: winnerData.displayName,
                score: winnerData.score,
                gemsAwarded: 100
            }
        });

    } catch (error) {
        console.error('[AWARD-WINNER] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to award winner', details: error.message });
    }
}

module.exports = {
    handleLeaderboard,
    handleAwardWinner
};
