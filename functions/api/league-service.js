const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Mock names for filling leagues with fake users
const MOCK_NAMES = [
    'Emma', 'Liam', 'Sofia', 'Noah', 'Ava', 'Oliver', 'Isabella', 'Lucas',
    'Mia', 'Ethan', 'Charlotte', 'Mason', 'Amelia', 'Logan', 'Harper', 'James',
    'Evelyn', 'Alexander', 'Aria', 'Sebastian', 'Luna', 'Jack', 'Chloe', 'Henry',
    'Penelope', 'Owen', 'Layla', 'Julian', 'Riley', 'Leo', 'Zoey', 'Adam',
    'Victoria', 'Benjamin', 'Eleanor', 'William', 'Scarlett', 'Daniel', 'Grace', 'Matthew'
];

const LEAGUE_TIERS = {
    bronze: { name: 'Bronze', minScore: 0, icon: '🥉', color: '#CD7F32' },
    silver: { name: 'Silver', minScore: 50, icon: '🥈', color: '#C0C0C0' },
    gold: { name: 'Gold', minScore: 150, icon: '🥇', color: '#FFD700' },
    diamond: { name: 'Diamond', minScore: 350, icon: '💎', color: '#B9F2FF' },
    master: { name: 'Master', minScore: 700, icon: '👑', color: '#9B59B6' },
};

const LEAGUE_SIZE = 10;
const MIN_REAL_USERS = 3;

/**
 * Get the current week ID using ISO week date system (weeks start on Monday)
 */
function getWeekId() {
    const now = new Date();

    // Get the Thursday of the current week (ISO 8601 - week belongs to year of its Thursday)
    const thursday = new Date(now);
    thursday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + 3);

    // Get the first Thursday of the year
    const firstThursday = new Date(thursday.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);

    // Calculate the week number
    const weekNum = Math.floor((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1;

    return `${thursday.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

/**
 * Get user's tier based on their weekly score
 */
function getUserTier(score) {
    if (score >= LEAGUE_TIERS.master.minScore) return 'master';
    if (score >= LEAGUE_TIERS.diamond.minScore) return 'diamond';
    if (score >= LEAGUE_TIERS.gold.minScore) return 'gold';
    if (score >= LEAGUE_TIERS.silver.minScore) return 'silver';
    return 'bronze';
}

/**
 * Generate mock users with scores around a target range
 * Mock users have LOWER scores to make league beatable
 */
function generateMockUsers(count, minScore, maxScore) {
    const mocks = [];
    // Shuffle names to get variety
    const shuffledNames = [...MOCK_NAMES].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count; i++) {
        // Reduced score range - no daily bonus, 30-80% of max
        const reducedMin = Math.max(0, Math.floor(minScore * 0.3));
        const reducedMax = Math.floor(maxScore * 0.8);
        const score = Math.floor(Math.random() * (reducedMax - reducedMin)) + reducedMin;
        mocks.push({
            displayName: shuffledNames[i % shuffledNames.length],
            avatar: null,
            weeklyScore: score,
            isRealUser: false,
            userId: `mock_${i}_${Date.now()}`,
        });
    }
    return mocks;
}

/**
 * Get adjacent tier for merging when not enough users
 */
function getAdjacentTier(tier) {
    const tierOrder = ['bronze', 'silver', 'gold', 'diamond', 'master'];
    const currentIndex = tierOrder.indexOf(tier);

    // Prefer merging upward (into higher tier)
    if (currentIndex < tierOrder.length - 1) {
        return tierOrder[currentIndex + 1];
    }
    // If at master, merge downward
    if (currentIndex > 0) {
        return tierOrder[currentIndex - 1];
    }
    return null;
}

// Import cluster service
const clusterService = require('./league-cluster-service');

/**
 * Main league fetching handler - uses permanent weekly clusters
 */
async function handleGetLeague(req, res) {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId is required' });
        }

        const db = admin.firestore();

        // Get user's profile for display info and XP
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const userData = userDoc.data();
        const displayName = userData.username || userData.displayName || 'Player';
        const avatar = userData.equippedAvatar || userData.avatar || null;
        const userTotalXP = userData.xp || 0;

        // Get user's weekly score
        const weekId = clusterService.getWeekId();
        const weeklyScoreDoc = await db
            .collection('weeklyAggregatedScores')
            .doc(`${weekId}_${userId}`)
            .get();

        const userWeeklyScore = weeklyScoreDoc.exists
            ? (weeklyScoreDoc.data().totalScore || 0)
            : 0;

        // Get or create user's cluster
        const cluster = await clusterService.getUserCluster(userId, displayName, avatar, userTotalXP);

        if (!cluster) {
            return res.status(500).json({ success: false, error: 'Failed to get cluster' });
        }

        // Update user's current score and profile in cluster if changed
        const userInCluster = cluster.users.find(u => u.userId === userId);
        if (userInCluster) {
            const needsScoreUpdate = userInCluster.weeklyScore !== userWeeklyScore;
            const needsProfileUpdate = userInCluster.displayName !== displayName || userInCluster.avatar !== avatar;

            if (needsScoreUpdate || needsProfileUpdate) {
                // Update in database
                await clusterService.updateUserInCluster(userId, {
                    weeklyScore: userWeeklyScore,
                    displayName: displayName,
                    avatar: avatar,
                });

                // Update local data
                userInCluster.weeklyScore = userWeeklyScore;
                userInCluster.displayName = displayName;
                userInCluster.avatar = avatar;

                // Re-sort after score update
                cluster.users.sort((a, b) => b.weeklyScore - a.weeklyScore);
                // Re-assign ranks
                const hasDemotion = cluster.tierKey !== 'bronze';
                cluster.users = cluster.users.map((user, index) => ({
                    ...user,
                    rank: index + 1,
                    zone: index < 3 ? 'promotion' : (hasDemotion && index >= 7 ? 'demotion' : 'safe'),
                }));
            }
        }

        const userRank = cluster.users.findIndex(u => u.userId === userId) + 1;

        return res.json({
            success: true,
            league: cluster.users,
            userRank: userRank,
            tier: cluster.tier,
            tierKey: cluster.tierKey,
            clusterId: cluster.clusterId,
            realUserCount: cluster.realUserCount,
            mockUserCount: LEAGUE_SIZE - cluster.realUserCount,
            weekId: cluster.weekId,
        });

    } catch (error) {
        console.error('[LEAGUE] Error getting league:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Update user's display info in weekly scores when they earn stars
 * This is called to cache displayName and avatar for fast league lookups
 */
async function handleUpdateLeagueProfile(req, res) {
    try {
        const { userId, displayName, avatar } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId is required' });
        }

        const db = admin.firestore();
        const weekId = getWeekId();
        const docId = `${weekId}_${userId}`;

        await db.collection('weeklyAggregatedScores').doc(docId).set({
            displayName: displayName || 'Player',
            avatar: avatar || null,
        }, { merge: true });

        return res.json({ success: true });
    } catch (error) {
        console.error('[LEAGUE] Error updating profile:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Process weekly league results - called by n8n every Sunday
 * 1. Calculate each user's new tier based on weekly score
 * 2. Compare with previous tier stored in user document
 * 3. Update user document with new tier and pending promotion/demotion
 * 4. Send FCM push notification for tier changes
 */
async function handleProcessWeeklyResults(req, res) {
    try {
        // Verify n8n webhook secret
        const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
        const providedSecret = req.headers['x-webhook-secret'];

        if (webhookSecret && providedSecret !== webhookSecret) {
            console.error('[LEAGUE] Invalid webhook secret');
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const db = admin.firestore();
        const weekId = getWeekId();

        console.log(`[LEAGUE] Processing weekly results for ${weekId}...`);

        // Get all users with weekly scores
        const scoresSnapshot = await db
            .collection('weeklyAggregatedScores')
            .where('weekId', '==', weekId)
            .get();

        const results = {
            processed: 0,
            promotions: 0,
            demotions: 0,
            noChange: 0,
            notificationsSent: 0,
            errors: [],
        };

        const tierOrder = ['bronze', 'silver', 'gold', 'diamond', 'master'];

        for (const scoreDoc of scoresSnapshot.docs) {
            const scoreData = scoreDoc.data();
            const userId = scoreData.userId;

            if (!userId || userId.startsWith('mock_')) continue;

            try {
                // Get user document
                const userRef = db.collection('users').doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    console.log(`[LEAGUE] User ${userId} not found, skipping`);
                    continue;
                }

                const userData = userDoc.data();
                const previousTier = userData.leagueTier || 'bronze';
                const weeklyScore = scoreData.totalScore || 0;
                const newTier = getUserTier(weeklyScore);

                const previousTierIndex = tierOrder.indexOf(previousTier);
                const newTierIndex = tierOrder.indexOf(newTier);
                const tierChanged = previousTier !== newTier;
                const isPromotion = newTierIndex > previousTierIndex;

                // Update user document
                const updateData = {
                    leagueTier: newTier,
                    lastLeagueTierUpdate: admin.firestore.FieldValue.serverTimestamp(),
                };

                // Add pending promotion/demotion if tier changed
                if (tierChanged) {
                    updateData.pendingLeagueChange = {
                        previousTier,
                        newTier,
                        isPromotion,
                        weekId,
                        weeklyScore,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    };

                    if (isPromotion) {
                        results.promotions++;
                    } else {
                        results.demotions++;
                    }

                    // Send FCM notification if user has token
                    if (userData.fcmToken) {
                        try {
                            const tierConfig = LEAGUE_TIERS[newTier];
                            const message = {
                                token: userData.fcmToken,
                                notification: {
                                    title: isPromotion
                                        ? `${tierConfig.icon} Promoted to ${tierConfig.name}!`
                                        : `League Update`,
                                    body: isPromotion
                                        ? `Congratulations! You've been promoted to ${tierConfig.name} League!`
                                        : `You're now in ${tierConfig.name} League. Keep playing to climb back up!`,
                                },
                                data: {
                                    type: 'league_change',
                                    previousTier,
                                    newTier,
                                    isPromotion: String(isPromotion),
                                },
                                android: {
                                    priority: 'high',
                                    notification: {
                                        channelId: 'league_updates',
                                        icon: 'ic_notification',
                                    },
                                },
                                apns: {
                                    payload: {
                                        aps: {
                                            sound: 'default',
                                            badge: 1,
                                        },
                                    },
                                },
                            };

                            await admin.messaging().send(message);
                            results.notificationsSent++;
                            console.log(`[LEAGUE] ✅ Notification sent to ${userId}: ${isPromotion ? 'Promotion' : 'Demotion'} to ${newTier}`);
                        } catch (fcmError) {
                            console.error(`[LEAGUE] FCM error for ${userId}:`, fcmError.message);
                            results.errors.push({ userId, error: fcmError.message });
                        }
                    }
                } else {
                    results.noChange++;
                }

                await userRef.update(updateData);
                results.processed++;

            } catch (userError) {
                console.error(`[LEAGUE] Error processing user ${userId}:`, userError);
                results.errors.push({ userId, error: userError.message });
            }
        }

        console.log(`[LEAGUE] Weekly results processed:`, results);

        return res.json({
            success: true,
            weekId,
            results,
        });

    } catch (error) {
        console.error('[LEAGUE] Error processing weekly results:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    handleGetLeague,
    handleUpdateLeagueProfile,
    handleProcessWeeklyResults,
    getWeekId,
    getUserTier,
    LEAGUE_TIERS,
};
