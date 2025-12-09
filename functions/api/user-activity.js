const { extractUserId } = require('../utils/authMiddleware');
const { updateStreak } = require('../services/gamification');

/**
 * User Activity Endpoint
 * Tracks user login/activity and updates streaks
 * Can be called on app launch, login, or any user activity
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

    // Handle Health Check (GET) - No auth required
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            service: 'Linguana Backend Service (Vercel)',
            timestamp: new Date().toISOString(),
            endpoint: 'user-activity'
        });
    }

    // Check client secret if configured (Only for POST)
    const clientSecret = req.headers['x-client-secret'];
    if (process.env.APP_CLIENT_SECRET && clientSecret !== process.env.APP_CLIENT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Extract user ID from request (Firebase token or body)
        const userId = await extractUserId(req);

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        console.log(`👤 User activity tracked for: ${userId}`);

        // Update streak asynchronously (non-blocking)
        // We don't await this so the response is sent immediately
        updateStreak(userId).catch(error => {
            console.error('❌ Streak update error:', error.message);
            // Log error but don't fail the request
        });

        // Return success response immediately
        res.status(200).json({
            success: true,
            message: 'User activity tracked',
            userId: userId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ User activity tracking error:', error.message);
        res.status(500).json({
            error: 'Failed to track user activity',
            details: error.message
        });
    }
};
