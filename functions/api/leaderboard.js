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

        // Fetch current user data for all users in leaderboard
        // This ensures we display the current username, not the stale one from score time
        const userIds = snapshot.docs.map(doc => doc.data().userId);
        const userDocs = await Promise.all(
            userIds.map(uid => db.collection('users').doc(uid).get())
        );
        const userDataMap = {};
        userDocs.forEach(doc => {
            if (doc.exists) {
                userDataMap[doc.id] = doc.data();
            }
        });

        const leaderboardData = snapshot.docs.map((doc) => {
            const data = doc.data();
            const currentUser = userDataMap[data.userId] || {};
            return {
                userId: data.userId,
                // Use current username from users collection, fall back to score document data
                displayName: currentUser.displayName || currentUser.username || data.displayName || 'Anonymous',
                username: currentUser.username || data.username || null,
                score: data.score,
                maxScore: data.maxScore,
                percentage: Math.round((data.score / data.maxScore) * 100),
                completionTime: data.completionTime,
                correctAnswers: data.correctAnswers,
                wrongAnswers: data.wrongAnswers,
                usedAdContinue: data.usedAdContinue || false,
                completed: data.completed || false,
                // Use current avatar from users collection
                avatar: currentUser.equippedAvatar || data.avatar || null,
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

/**
 * Get daily gem reward based on rank
 */
function getDailyGemRewardForRank(rank) {
    if (rank === 1) return 100;
    if (rank === 2) return 75;
    if (rank === 3) return 50;
    if (rank >= 4 && rank <= 10) return 25;
    return 0;
}

/**
 * Get rank tier info for daily challenge
 */
function getDailyRankTierInfo(rank) {
    if (rank === 1) return { tier: 'gold', icon: '🥇', title: '1st Place Champion!' };
    if (rank === 2) return { tier: 'silver', icon: '🥈', title: '2nd Place Winner!' };
    if (rank === 3) return { tier: 'bronze', icon: '🥉', title: '3rd Place Winner!' };
    if (rank >= 4 && rank <= 10) return { tier: 'star', icon: '⭐', title: `Top 10 Finisher!` };
    return { tier: 'participant', icon: '🎮', title: 'Participant' };
}

async function handleAwardWinner(req, res) {
    try {
        // Validate webhook secret
        const webhookSecret = req.headers['x-webhook-secret'] || req.headers['x-client-secret'];
        if (webhookSecret !== process.env.N8N_WEBHOOK_SECRET && webhookSecret !== process.env.APP_CLIENT_SECRET) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const { date } = req.query || req.body || {};
        const db = admin.firestore();

        const targetDate = date || (() => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return yesterday.toISOString().split('T')[0];
        })();

        console.log(`[DAILY-AWARD] Processing awards for date: ${targetDate}`);

        // Check if already processed
        const awardRecordRef = db.collection('dailyAwardRecords').doc(targetDate);
        const awardRecordDoc = await awardRecordRef.get();

        if (awardRecordDoc.exists && awardRecordDoc.data().processed) {
            return res.status(200).json({
                success: true,
                message: 'Awards already processed for this date',
                date: targetDate,
                alreadyProcessed: true,
                winners: awardRecordDoc.data().winners || []
            });
        }

        // Query top 10
        const scoresRef = db.collection('dailyChallengeScores');
        const query = scoresRef
            .where('date', '==', targetDate)
            .orderBy('score', 'desc')
            .orderBy('completionTime', 'asc')
            .limit(10);

        const snapshot = await query.get();

        if (snapshot.empty) {
            return res.status(200).json({
                success: true,
                message: `No participants found for ${targetDate}`,
                date: targetDate,
                winnersCount: 0,
                winners: []
            });
        }

        const winners = [];
        const batch = db.batch();

        // Process each winner
        for (let i = 0; i < snapshot.docs.length; i++) {
            const doc = snapshot.docs[i];
            const scoreData = doc.data();
            const rank = i + 1;
            const gems = getDailyGemRewardForRank(rank);
            const tierInfo = getDailyRankTierInfo(rank);

            if (gems <= 0) continue;

            // Skip if already awarded
            if (scoreData.gemAwarded) {
                winners.push({
                    rank,
                    userId: scoreData.userId,
                    displayName: scoreData.displayName || 'Anonymous',
                    score: scoreData.score,
                    gems: 0,
                    tier: tierInfo.tier,
                    alreadyAwarded: true
                });
                continue;
            }

            const userId = scoreData.userId;
            const userRef = db.collection('users').doc(userId);

            // Award gems
            batch.update(userRef, {
                gems: FieldValue.increment(gems)
            });

            // Set pending daily reward notification (optional - for modal)
            batch.update(userRef, {
                pendingDailyReward: {
                    date: targetDate,
                    rank,
                    gems,
                    tier: tierInfo.tier,
                    icon: tierInfo.icon,
                    title: tierInfo.title,
                    score: scoreData.score,
                    awardedAt: new Date().toISOString()
                }
            });

            // Mark score as awarded
            batch.update(doc.ref, {
                gemAwarded: true,
                gemAwardedAt: FieldValue.serverTimestamp(),
                gemsAwarded: gems,
                rank
            });

            winners.push({
                rank,
                userId,
                displayName: scoreData.displayName || 'Anonymous',
                score: scoreData.score,
                completionTime: scoreData.completionTime,
                gems,
                tier: tierInfo.tier,
                icon: tierInfo.icon
            });

            console.log(`[DAILY-AWARD] Rank ${rank}: ${scoreData.displayName} - ${gems} gems`);
        }

        // Save award record
        batch.set(awardRecordRef, {
            date: targetDate,
            processed: true,
            processedAt: FieldValue.serverTimestamp(),
            winnersCount: winners.filter(w => !w.alreadyAwarded).length,
            winners
        });

        // Commit all updates
        await batch.commit();

        const newlyAwarded = winners.filter(w => !w.alreadyAwarded);
        console.log(`[DAILY-AWARD] Successfully awarded ${newlyAwarded.length} winners for ${targetDate}`);

        return res.status(200).json({
            success: true,
            message: `Successfully awarded ${newlyAwarded.length} winners`,
            date: targetDate,
            winnersCount: newlyAwarded.length,
            totalGemsAwarded: newlyAwarded.reduce((sum, w) => sum + w.gems, 0),
            winners // Full list for n8n email
        });

    } catch (error) {
        console.error('[DAILY-AWARD] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to award winner', details: error.message });
    }
}

module.exports = {
    handleLeaderboard,
    handleAwardWinner
};
