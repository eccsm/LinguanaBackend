/**
 * Expedition Map API
 * Dynamic map configuration for weekly expeditions
 * 
 * GET /api/expedition/map - Get current week's expedition map
 */

const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();

// Default weekly expedition nodes (Mon-Sun)
const DEFAULT_WEEKLY_NODES = [
    { id: 1, label: 'Monday', x: 0.2, y: 0.1, reward: 50 },
    { id: 2, label: 'Tuesday', x: 0.5, y: 0.2, reward: 50 },
    { id: 3, label: 'Wednesday', x: 0.8, y: 0.3, reward: 50 },
    { id: 4, label: 'Thursday', x: 0.5, y: 0.45, reward: 50 },
    { id: 5, label: 'Friday', x: 0.2, y: 0.6, reward: 50 },
    { id: 6, label: 'Saturday', x: 0.5, y: 0.75, reward: 75 },
    { id: 7, label: 'Sunday', x: 0.8, y: 0.9, isChest: true, reward: 200 },
];

/**
 * Get current week ID (Monday's date in UTC)
 */
function getCurrentWeekId() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - daysToMonday);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0]; // e.g., "2024-12-16"
}

/**
 * Get current day of week in UTC (1=Mon, 7=Sun)
 */
function getCurrentDayUTC() {
    const day = new Date().getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    return day === 0 ? 7 : day; // Convert to 1=Mon, ..., 7=Sun
}

/**
 * GET /api/expedition/map
 * Returns the expedition map configuration for the current week
 */
async function handleGetExpeditionMap(req, res) {
    try {
        const userId = req.query.userId || req.body?.userId;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const weekId = getCurrentWeekId();
        const currentDayUTC = getCurrentDayUTC();

        // Try to fetch custom expedition config for this week (for future special events)
        let nodes = DEFAULT_WEEKLY_NODES;
        let theme = 'weekly_puzzle';

        try {
            const expeditionDoc = await admin.firestore()
                .collection('expeditions')
                .doc(weekId)
                .get();

            if (expeditionDoc.exists) {
                const data = expeditionDoc.data();
                if (data.nodes && Array.isArray(data.nodes)) {
                    nodes = data.nodes;
                }
                if (data.theme) {
                    theme = data.theme;
                }
            }
        } catch (expeditionError) {
            // If no custom expedition, use defaults (this is fine)
            console.log('Using default expedition nodes for week:', weekId);
        }

        // Fetch user's completed days for this week from weeklyScores
        // This is the source of truth - check actual completed game records
        let completedDays = [];
        let unlockedDays = [];
        try {
            // Query weeklyScores for this user's completed puzzles this week
            const scoresSnapshot = await admin.firestore()
                .collection('weeklyScores')
                .where('userId', '==', userId)
                .where('weekId', '==', weekId)
                .where('completed', '==', true)
                .get();

            if (!scoresSnapshot.empty) {
                scoresSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    // Convert puzzleDate (e.g., "2025-12-16") to day of week (1-7)
                    if (data.puzzleDate) {
                        const puzzleDate = new Date(data.puzzleDate + 'T00:00:00Z');
                        const dayOfWeek = puzzleDate.getUTCDay();
                        const dayId = dayOfWeek === 0 ? 7 : dayOfWeek; // Convert Sun=0 to Sun=7
                        if (!completedDays.includes(dayId)) {
                            completedDays.push(dayId);
                        }
                    }
                });
            }

            // Also check users/{userId} for weeklyCompletedDays and weeklyUnlockedDays as fallback
            // BUT only if the stored weekId matches current week (prevents stale data)

            const userDoc = await admin.firestore()
                .collection('users')
                .doc(userId)
                .get();

            if (userDoc.exists) {
                const userData = userDoc.data();
                const storedWeekId = userData.weeklyCompletedWeekId;
                const hasStaleData = userData.weeklyCompletedDays?.length > 0 || userData.weeklyUnlockedDays?.length > 0;

                // Only use stored data if it's from the current week
                if (storedWeekId === weekId) {
                    const userCompletedDays = userData.weeklyCompletedDays || [];
                    // Merge with existing (avoid duplicates)
                    userCompletedDays.forEach(day => {
                        if (!completedDays.includes(day)) {
                            completedDays.push(day);
                        }
                    });
                    // Get unlocked days from user document
                    unlockedDays = userData.weeklyUnlockedDays || [];
                } else if (hasStaleData && storedWeekId !== weekId) {
                    // Old week data OR missing weekId - clear it asynchronously (don't wait)
                    // This handles legacy data that was stored without a weekId
                    console.log(`[EXPEDITION] Clearing stale week data for user ${userId}. Old weekId: ${storedWeekId || 'none'}, Current: ${weekId}`);
                    admin.firestore()
                        .collection('users')
                        .doc(userId)
                        .update({
                            weeklyCompletedDays: [],
                            weeklyUnlockedDays: [],
                            weeklyCompletedWeekId: weekId,
                        })
                        .catch(err => console.log('Failed to clear old week data:', err));
                }
            }

            // Sort for consistent display
            completedDays.sort((a, b) => a - b);

        } catch (userError) {
            console.error('Error fetching user completed days:', userError);
        }

        return res.status(200).json({
            weekId,
            nodes,
            currentDayUTC,
            completedDays,
            unlockedDays,
            theme,
        });

    } catch (error) {
        console.error('Error in handleGetExpeditionMap:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
    handleGetExpeditionMap,
};
