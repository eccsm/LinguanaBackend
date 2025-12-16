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

const LEAGUE_SIZE = 30;
const MIN_REAL_USERS = 5;

/**
 * Get the current week ID in format YYYY-WW
 */
function getWeekId() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now - start;
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    const weekNum = Math.floor(diff / oneWeek) + 1;
    return `${now.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
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
 */
function generateMockUsers(count, minScore, maxScore) {
    const mocks = [];
    for (let i = 0; i < count; i++) {
        const score = Math.floor(Math.random() * (maxScore - minScore)) + minScore;
        mocks.push({
            odisplayName: MOCK_NAMES[Math.floor(Math.random() * MOCK_NAMES.length)],
            avatar: null,
            weeklyScore: score,
            isRealUser: false,
            userId: `mock_${Date.now()}_${i}`,
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

/**
 * Main league fetching handler
 */
async function handleGetLeague(req, res) {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId is required' });
        }

        const db = admin.firestore();
        const weekId = getWeekId();

        // Get all weekly scores for current week
        const scoresSnapshot = await db
            .collection('weeklyAggregatedScores')
            .where('weekId', '==', weekId)
            .orderBy('totalScore', 'desc')
            .get();

        // Get requesting user's score
        let userScore = 0;
        let userDoc = null;

        scoresSnapshot.docs.forEach(doc => {
            if (doc.data().userId === userId) {
                userScore = doc.data().totalScore || 0;
                userDoc = doc.data();
            }
        });

        // Determine user's tier
        const userTier = getUserTier(userScore);
        const tierConfig = LEAGUE_TIERS[userTier];

        // Get tier score boundaries
        const tierOrder = ['bronze', 'silver', 'gold', 'diamond', 'master'];
        const tierIndex = tierOrder.indexOf(userTier);
        const minTierScore = tierConfig.minScore;
        const maxTierScore = tierIndex < tierOrder.length - 1
            ? LEAGUE_TIERS[tierOrder[tierIndex + 1]].minScore
            : 9999;

        // Filter users in the same tier
        let realUsers = scoresSnapshot.docs
            .map(doc => ({
                userId: doc.data().userId,
                displayName: doc.data().displayName || 'Player',
                avatar: doc.data().avatar || null,
                weeklyScore: doc.data().totalScore || 0,
                isRealUser: true,
            }))
            .filter(u => {
                const tier = getUserTier(u.weeklyScore);
                return tier === userTier;
            });

        console.log(`[LEAGUE] Found ${realUsers.length} real users in ${userTier} tier`);

        // If not enough real users, try merging with adjacent tier
        if (realUsers.length < MIN_REAL_USERS) {
            const adjacentTier = getAdjacentTier(userTier);
            if (adjacentTier) {
                const additionalUsers = scoresSnapshot.docs
                    .map(doc => ({
                        userId: doc.data().userId,
                        displayName: doc.data().displayName || 'Player',
                        avatar: doc.data().avatar || null,
                        weeklyScore: doc.data().totalScore || 0,
                        isRealUser: true,
                    }))
                    .filter(u => {
                        const tier = getUserTier(u.weeklyScore);
                        return tier === adjacentTier;
                    });

                realUsers = [...realUsers, ...additionalUsers];
                console.log(`[LEAGUE] Merged with ${adjacentTier}, now ${realUsers.length} real users`);
            }
        }

        // Sort by score descending
        realUsers.sort((a, b) => b.weeklyScore - a.weeklyScore);

        // Limit to top LEAGUE_SIZE real users
        if (realUsers.length > LEAGUE_SIZE) {
            realUsers = realUsers.slice(0, LEAGUE_SIZE);
        }

        // Calculate how many mocks needed
        const mocksNeeded = LEAGUE_SIZE - realUsers.length;

        let league = [...realUsers];

        if (mocksNeeded > 0) {
            // Calculate score ranges for mocks based on tier
            const scoreRange = {
                min: Math.max(0, minTierScore),
                max: maxTierScore,
            };

            // Generate mocks - some above and some below the user
            const mocksAbove = Math.floor(mocksNeeded * 0.4);
            const mocksBelow = mocksNeeded - mocksAbove;

            // Mocks above user (higher scores)
            const highMocks = generateMockUsers(
                mocksAbove,
                userScore + 5,
                Math.min(userScore + 100, scoreRange.max)
            );

            // Mocks below user (lower scores)
            const lowMocks = generateMockUsers(
                mocksBelow,
                scoreRange.min,
                Math.max(userScore - 5, scoreRange.min + 10)
            );

            league = [...highMocks, ...realUsers, ...lowMocks];
        }

        // Sort final league by score
        league.sort((a, b) => b.weeklyScore - a.weeklyScore);

        // Assign ranks and zones
        league = league.map((user, index) => ({
            ...user,
            rank: index + 1,
            zone: index < 5 ? 'promotion' : (index >= 25 ? 'demotion' : 'safe'),
        }));

        // Find user's rank
        const userRank = league.findIndex(u => u.userId === userId) + 1;

        // Ensure current user is in the league
        if (userRank === 0 && userDoc) {
            // User not in league, add them
            const currentUser = {
                userId: userId,
                displayName: userDoc.displayName || 'You',
                avatar: userDoc.avatar || null,
                weeklyScore: userScore,
                isRealUser: true,
                rank: league.length + 1,
                zone: 'safe',
            };
            league.push(currentUser);
            league.sort((a, b) => b.weeklyScore - a.weeklyScore);
            league = league.map((user, index) => ({
                ...user,
                rank: index + 1,
                zone: index < 5 ? 'promotion' : (index >= 25 ? 'demotion' : 'safe'),
            }));
        }

        return res.json({
            success: true,
            league,
            userRank: league.findIndex(u => u.userId === userId) + 1,
            tier: {
                key: userTier,
                ...tierConfig,
            },
            realUserCount: realUsers.length,
            mockUserCount: mocksNeeded > 0 ? mocksNeeded : 0,
            weekId,
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
