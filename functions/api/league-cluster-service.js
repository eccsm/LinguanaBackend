/**
 * League Cluster Service
 * Manages permanent weekly clusters for the league system (Duolingo-style)
 * 
 * Structure:
 * - Users are assigned to clusters of 10 when they first earn XP in a week
 * - Clusters persist for the entire week
 * - Mocks fill empty slots; get replaced by real users if space available
 * - Weekly reset creates fresh clusters
 */

const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();

const CLUSTER_SIZE = 10;
const MOCK_NAMES = [
    'Emma', 'Liam', 'Sofia', 'Noah', 'Ava', 'Oliver', 'Isabella', 'Lucas',
    'Mia', 'Ethan', 'Charlotte', 'Mason', 'Amelia', 'Logan', 'Harper', 'James',
    'Evelyn', 'Alexander', 'Aria', 'Sebastian', 'Luna', 'Jack', 'Chloe', 'Henry',
    'Penelope', 'Owen', 'Layla', 'Julian', 'Riley', 'Leo', 'Zoey', 'Adam'
];

const LEAGUE_TIERS = {
    bronze: { name: 'Bronze', minScore: 0, icon: '🥉', color: '#CD7F32' },
    silver: { name: 'Silver', minScore: 50, icon: '🥈', color: '#C0C0C0' },
    gold: { name: 'Gold', minScore: 150, icon: '🥇', color: '#FFD700' },
    diamond: { name: 'Diamond', minScore: 350, icon: '💎', color: '#B9F2FF' },
    master: { name: 'Master', minScore: 700, icon: '👑', color: '#9B59B6' },
};

/**
 * Get current week ID using ISO week date system (weeks start on Monday)
 */
function getWeekId() {
    const now = new Date();
    const thursday = new Date(now);
    thursday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + 3);
    const firstThursday = new Date(thursday.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
    const weekNum = Math.floor((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return `${thursday.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

/**
 * Get user's tier based on their total XP (not weekly score)
 */
function getUserTier(xp) {
    if (xp >= LEAGUE_TIERS.master.minScore) return 'master';
    if (xp >= LEAGUE_TIERS.diamond.minScore) return 'diamond';
    if (xp >= LEAGUE_TIERS.gold.minScore) return 'gold';
    if (xp >= LEAGUE_TIERS.silver.minScore) return 'silver';
    return 'bronze';
}

/**
 * Generate mock users for a cluster
 * Mocks have fixed scores based on tier (no daily progression)
 * Mocks get random avatars for visual variety
 */
function generateMockUsers(count, tier) {
    const mocks = [];
    const shuffledNames = [...MOCK_NAMES].sort(() => Math.random() - 0.5);

    // Available avatar keys (matching frontend AVATAR_IMAGES)
    const MOCK_AVATARS = [
        'avatar_gecko',
        'avatar_chameleon',
        'avatar_dragon',
        'avatar_axolotl',
        'avatar_mascott',
        'avatar_speedy',
    ];

    // Score ranges by tier (fixed, no daily bonus)
    const tierScoreRanges = {
        bronze: { min: 5, max: 40 },
        silver: { min: 20, max: 80 },
        gold: { min: 50, max: 150 },
        diamond: { min: 100, max: 250 },
        master: { min: 150, max: 400 },
    };

    const range = tierScoreRanges[tier] || tierScoreRanges.bronze;

    for (let i = 0; i < count; i++) {
        const score = Math.floor(Math.random() * (range.max - range.min)) + range.min;
        // Assign random avatar from available list
        const randomAvatar = MOCK_AVATARS[Math.floor(Math.random() * MOCK_AVATARS.length)];
        mocks.push({
            userId: `mock_${Date.now()}_${i}`,
            displayName: shuffledNames[i % shuffledNames.length],
            avatar: randomAvatar,
            weeklyScore: score,
            isRealUser: false,
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    return mocks;
}

/**
 * Find or create a cluster for a user
 * 
 * Logic:
 * 1. Check if user already has a cluster assignment this week
 * 2. If yes, return that cluster
 * 3. If no, find an unfilled cluster in user's tier OR create new one
 * 4. Assign user and return cluster
 */
async function assignUserToCluster(userId, displayName, avatar, tier) {
    const db = admin.firestore();
    const weekId = getWeekId();

    console.log(`[CLUSTER] Assigning user ${userId} to cluster for ${weekId}, tier: ${tier}`);

    // Check if user already assigned this week
    const userAssignmentDoc = await db
        .collection('leagueClusterAssignments')
        .doc(`${weekId}_${userId}`)
        .get();

    if (userAssignmentDoc.exists) {
        const assignment = userAssignmentDoc.data();
        console.log(`[CLUSTER] User already assigned to cluster ${assignment.clusterId}`);
        return assignment.clusterId;
    }

    // Find an unfilled cluster in user's tier
    const unfilledClusters = await db
        .collection('leagueClusters')
        .where('weekId', '==', weekId)
        .where('tier', '==', tier)
        .where('realUserCount', '<', CLUSTER_SIZE)
        .orderBy('realUserCount', 'desc') // Prefer clusters with more real users
        .limit(1)
        .get();

    let clusterId;
    let clusterRef;

    if (!unfilledClusters.empty) {
        // Found an unfilled cluster - add user to it
        clusterId = unfilledClusters.docs[0].id;
        clusterRef = db.collection('leagueClusters').doc(clusterId);

        console.log(`[CLUSTER] Found unfilled cluster ${clusterId}`);

        // Replace a mock user with the real user
        await db.runTransaction(async (transaction) => {
            const clusterDoc = await transaction.get(clusterRef);
            const clusterData = clusterDoc.data();
            let users = clusterData.users || [];

            // Find first mock user and replace them
            const mockIndex = users.findIndex(u => !u.isRealUser);
            if (mockIndex !== -1) {
                users[mockIndex] = {
                    userId: userId,
                    displayName: displayName || 'Player',
                    avatar: avatar || null,
                    weeklyScore: 0,
                    isRealUser: true,
                    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
            } else {
                // No mock to replace, just add
                users.push({
                    userId: userId,
                    displayName: displayName || 'Player',
                    avatar: avatar || null,
                    weeklyScore: 0,
                    isRealUser: true,
                    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            transaction.update(clusterRef, {
                users: users,
                realUserCount: admin.firestore.FieldValue.increment(1),
            });
        });
    } else {
        // No unfilled cluster - create new one
        clusterId = `${weekId}_${tier}_${Date.now()}`;
        clusterRef = db.collection('leagueClusters').doc(clusterId);

        console.log(`[CLUSTER] Creating new cluster ${clusterId}`);

        // Create user entry
        const userEntry = {
            userId: userId,
            displayName: displayName || 'Player',
            avatar: avatar || null,
            weeklyScore: 0,
            isRealUser: true,
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Generate mocks to fill cluster
        const mocks = generateMockUsers(CLUSTER_SIZE - 1, tier);
        const users = [userEntry, ...mocks];

        await clusterRef.set({
            weekId: weekId,
            tier: tier,
            users: users,
            realUserCount: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // Save user's cluster assignment
    await db.collection('leagueClusterAssignments').doc(`${weekId}_${userId}`).set({
        userId: userId,
        clusterId: clusterId,
        weekId: weekId,
        tier: tier,
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[CLUSTER] User ${userId} assigned to cluster ${clusterId}`);
    return clusterId;
}

/**
 * Update user's score in their cluster
 * Called when user earns stars
 */
async function updateUserScoreInCluster(userId, newScore) {
    const db = admin.firestore();
    const weekId = getWeekId();

    // Get user's cluster assignment
    const assignmentDoc = await db
        .collection('leagueClusterAssignments')
        .doc(`${weekId}_${userId}`)
        .get();

    if (!assignmentDoc.exists) {
        console.log(`[CLUSTER] User ${userId} not assigned to cluster yet`);
        return false;
    }

    const { clusterId } = assignmentDoc.data();
    const clusterRef = db.collection('leagueClusters').doc(clusterId);

    await db.runTransaction(async (transaction) => {
        const clusterDoc = await transaction.get(clusterRef);
        if (!clusterDoc.exists) return;

        const clusterData = clusterDoc.data();
        const users = clusterData.users || [];

        // Find user and update their score
        const userIndex = users.findIndex(u => u.userId === userId);
        if (userIndex !== -1) {
            users[userIndex].weeklyScore = newScore;
            transaction.update(clusterRef, { users: users });
        }
    });

    console.log(`[CLUSTER] Updated user ${userId} score to ${newScore} in cluster ${clusterId}`);
    return true;
}

/**
 * Update user's profile and score in their cluster
 * Called when user fetches league to sync their current profile
 */
async function updateUserInCluster(userId, updates) {
    const db = admin.firestore();
    const weekId = getWeekId();

    // Get user's cluster assignment
    const assignmentDoc = await db
        .collection('leagueClusterAssignments')
        .doc(`${weekId}_${userId}`)
        .get();

    if (!assignmentDoc.exists) {
        console.log(`[CLUSTER] User ${userId} not assigned to cluster yet`);
        return false;
    }

    const { clusterId } = assignmentDoc.data();
    const clusterRef = db.collection('leagueClusters').doc(clusterId);

    await db.runTransaction(async (transaction) => {
        const clusterDoc = await transaction.get(clusterRef);
        if (!clusterDoc.exists) return;

        const clusterData = clusterDoc.data();
        const users = clusterData.users || [];

        // Find user and update their profile
        const userIndex = users.findIndex(u => u.userId === userId);
        if (userIndex !== -1) {
            if (updates.weeklyScore !== undefined) {
                users[userIndex].weeklyScore = updates.weeklyScore;
            }
            if (updates.displayName !== undefined) {
                users[userIndex].displayName = updates.displayName;
            }
            if (updates.avatar !== undefined) {
                users[userIndex].avatar = updates.avatar;
            }
            transaction.update(clusterRef, { users: users });
        }
    });

    console.log(`[CLUSTER] Updated user ${userId} profile in cluster ${clusterId}`);
    return true;
}

/**
 * Get user's cluster with current standings
 */
async function getUserCluster(userId, displayName, avatar, userTotalXP) {
    const db = admin.firestore();
    const weekId = getWeekId();
    const tier = getUserTier(userTotalXP);

    // Ensure user is assigned to a cluster
    const clusterId = await assignUserToCluster(userId, displayName, avatar, tier);

    // Get cluster data
    const clusterDoc = await db.collection('leagueClusters').doc(clusterId).get();

    if (!clusterDoc.exists) {
        console.error(`[CLUSTER] Cluster ${clusterId} not found`);
        return null;
    }

    const clusterData = clusterDoc.data();
    let users = clusterData.users || [];

    // Sort by score descending
    users.sort((a, b) => b.weeklyScore - a.weeklyScore);

    // Assign ranks and zones (top 3 promote, bottom 3 demote if not bronze)
    const hasDemotion = tier !== 'bronze';
    users = users.map((user, index) => ({
        ...user,
        rank: index + 1,
        zone: index < 3 ? 'promotion' : (hasDemotion && index >= 7 ? 'demotion' : 'safe'),
    }));

    return {
        clusterId: clusterId,
        weekId: weekId,
        tier: LEAGUE_TIERS[tier],
        tierKey: tier,
        users: users,
        realUserCount: clusterData.realUserCount,
    };
}

/**
 * Weekly reset - clear all clusters
 * Called by n8n on Sunday night
 */
async function resetWeeklyClusters() {
    const db = admin.firestore();
    const weekId = getWeekId();

    console.log(`[CLUSTER] Processing weekly reset for ${weekId}...`);

    // Get all clusters from this week (to process promotions/demotions first if needed)
    const clustersSnapshot = await db
        .collection('leagueClusters')
        .where('weekId', '==', weekId)
        .get();

    console.log(`[CLUSTER] Found ${clustersSnapshot.size} clusters to process`);

    // Process each cluster for promotions/demotions
    const batch = db.batch();
    const results = { promotions: 0, demotions: 0, processed: 0 };

    for (const clusterDoc of clustersSnapshot.docs) {
        const cluster = clusterDoc.data();
        const tier = cluster.tier;
        const hasDemotion = tier !== 'bronze';

        // Sort users by score
        const users = (cluster.users || []).sort((a, b) => b.weeklyScore - a.weeklyScore);

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            if (!user.isRealUser) continue;

            const isPromotion = i < 3; // Top 3
            const isDemotion = hasDemotion && i >= 7; // Bottom 3

            if (isPromotion || isDemotion) {
                const userRef = db.collection('users').doc(user.userId);

                // Queue tier update
                batch.update(userRef, {
                    pendingLeagueChange: {
                        previousTier: tier,
                        isPromotion: isPromotion,
                        weekId: weekId,
                        weeklyScore: user.weeklyScore,
                        rank: i + 1,
                    },
                });

                if (isPromotion) results.promotions++;
                else results.demotions++;
            }
        }

        results.processed++;
    }

    await batch.commit();

    console.log(`[CLUSTER] Weekly reset complete:`, results);
    return results;
}

module.exports = {
    getWeekId,
    getUserTier,
    assignUserToCluster,
    updateUserScoreInCluster,
    updateUserInCluster,
    getUserCluster,
    resetWeeklyClusters,
    LEAGUE_TIERS,
    CLUSTER_SIZE,
};
