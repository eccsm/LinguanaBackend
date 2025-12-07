const { extractUserId } = require('../utils/authMiddleware');
const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const db = admin.firestore();

/**
 * Create Profile Endpoint
 * Securely initializes a new user profile with default stats
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

        const { email, displayName } = req.body;

        console.log(`👤 Creating profile for user: ${userId}`);

        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (doc.exists) {
            console.log(`⚠️ Profile already exists for ${userId}, skipping creation`);
            return res.status(200).json({
                success: true,
                message: 'Profile already exists',
                profile: doc.data()
            });
        }

        // Generate random username
        const randomNum = Math.floor(10000 + Math.random() * 90000);
        const username = `Learner_${randomNum}`;

        // Default profile data
        const profileData = {
            email: email || null,
            displayName: displayName || 'User',
            username: username,
            usernameChanges: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            subscriptionTier: 'free',
            dailyUsage: 0,
            lastUsageReset: admin.firestore.FieldValue.serverTimestamp(),
            currentStreak: 0,
            longestStreak: 0,
            previousStreak: 0,
            lastPracticeDate: null,
            totalConversations: 0,
            preferredLanguage: null,
            correctionMode: true,
            gems: 0, // Securely set to 0
            xp: 0,   // Securely set to 0
            inventory: {},
            activeBuffs: {},
            // Initialize ad stats
            adStats: {
                dailyChatAds: 0,
                dailyInterviewAds: 0,
                lastAdDate: null
            }
        };

        await userRef.set(profileData);

        console.log(`✅ Profile created successfully for ${userId}`);

        res.status(201).json({
            success: true,
            message: 'Profile created successfully',
            profile: profileData
        });

    } catch (error) {
        console.error('❌ Profile creation error:', error.message);
        res.status(500).json({
            error: 'Failed to create profile',
            details: error.message
        });
    }
};
