const { extractUserId } = require('../utils/authMiddleware');
const { grantSessionRewards, grantAdReward } = require('../services/gamification');

/**
 * Grant Rewards Endpoint
 * Awards XP and Gems for completing sessions
 * Awards Extra Chats/Interviews for watching ads
 */
module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-client-secret');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Check client secret if configured
    const clientSecret = req.headers['x-client-secret'];
    if (process.env.APP_CLIENT_SECRET && clientSecret !== process.env.APP_CLIENT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Extract user ID from request
        const userId = await extractUserId(req);

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Extract session type and sessionId from request body
        const { type, sessionId, rewardType } = req.body;

        if (!type) {
            return res.status(400).json({
                error: 'Session type is required',
                expectedValues: 'review, roleplay, ad_reward'
            });
        }

        // Handle Ad Rewards
        if (type === 'ad_reward') {
            if (!rewardType) {
                return res.status(400).json({ error: 'Reward type is required for ad rewards (chat/interview)' });
            }

            console.log(`🎁 Granting ad reward (${rewardType}) to user: ${userId}`);
            const result = await grantAdReward(userId, rewardType);

            if (!result.success) {
                return res.status(400).json(result);
            }

            return res.status(200).json(result);
        }

        // Handle Session Rewards (Review/Roleplay)
        if (!sessionId) {
            return res.status(400).json({
                error: 'Session ID is required to prevent duplicate rewards'
            });
        }

        console.log(`🎁 Granting rewards for ${type} session (${sessionId}) to user: ${userId}`);

        // Grant the rewards
        const result = await grantSessionRewards(userId, type, sessionId);

        if (!result.success) {
            // Check if session was already rewarded
            if (result.alreadyRewarded) {
                return res.status(409).json({
                    error: result.error,
                    alreadyRewarded: true,
                    message: 'This session has already been rewarded'
                });
            }

            return res.status(400).json({
                error: result.error || 'Failed to grant rewards'
            });
        }

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Rewards granted successfully',
            userId: userId,
            sessionId: result.sessionId,
            xpAwarded: result.xpAwarded,
            gemsAwarded: result.gemsAwarded,
            sessionType: result.sessionType
        });

    } catch (error) {
        console.error('❌ Reward granting error:', error.message);
        res.status(500).json({
            error: 'Failed to grant rewards',
            details: error.message
        });
    }
};
