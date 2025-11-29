const { extractUserId } = require('../utils/authMiddleware');
const { initializeFirebase } = require('../utils/firebaseInit');

const admin = initializeFirebase();
const db = admin.firestore();

/**
 * Check Session Rewarded Endpoint
 * Checks if a session has already been rewarded (for preventing duplicate modals)
 */
module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Extract user ID from request
        const userId = await extractUserId(req);

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get sessionId from body (POST) or query (GET)
        const sessionId = req.method === 'POST' ? req.body.sessionId : req.query.sessionId;

        if (!sessionId) {
            return res.status(400).json({ 
                error: 'Session ID is required'
            });
        }

        console.log(`[CHECK_REWARD] 🔍 Checking if session ${sessionId} was rewarded for user: ${userId}`);

        // Check if session is in rewardedSessions array
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            return res.status(404).json({
                error: 'User not found',
                rewarded: false
            });
        }

        const userData = userDoc.data();
        const rewardedSessions = userData.rewardedSessions || [];
        const isRewarded = rewardedSessions.includes(sessionId);

        console.log(`[CHECK_REWARD] ${isRewarded ? '✅' : '⏳'} Session ${sessionId} ${isRewarded ? 'already rewarded' : 'not yet rewarded'}`);

        // Return the status
        res.status(200).json({
            success: true,
            sessionId: sessionId,
            rewarded: isRewarded,
            message: isRewarded ? 'Session already rewarded' : 'Session not yet rewarded'
        });

    } catch (error) {
        console.error('[CHECK_REWARD] ❌ Error checking reward status:', error.message);
        res.status(500).json({
            error: 'Failed to check reward status',
            details: error.message
        });
    }
};
