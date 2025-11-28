const { extractUserId } = require('../utils/authMiddleware');
const { extractVocabularyFromConversation } = require('../services/vocabularyExtraction');

/**
 * Extract Vocabulary Endpoint
 * Extracts vocabulary from a completed conversation and adds to user's deck
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

        // Extract conversation data from request body
        const { conversationId, messages, targetLanguage, nativeLanguage } = req.body;

        if (!conversationId || !messages || !Array.isArray(messages)) {
            return res.status(400).json({ 
                error: 'Invalid request format',
                required: 'conversationId, messages (array), targetLanguage, nativeLanguage'
            });
        }

        console.log(`📚 Extracting vocabulary from conversation ${conversationId} for user: ${userId}`);

        // Extract and add vocabulary
        const result = await extractVocabularyFromConversation(
            userId, 
            conversationId, 
            messages, 
            targetLanguage || 'es',
            nativeLanguage || 'en'
        );

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Vocabulary extracted and added successfully',
            userId: userId,
            conversationId: conversationId,
            wordsAdded: result.wordsAdded,
            totalWords: result.totalWords
        });

    } catch (error) {
        console.error('❌ Vocabulary extraction error:', error.message);
        res.status(500).json({
            error: 'Failed to extract vocabulary',
            details: error.message
        });
    }
};
