const { extractUserId } = require('../utils/authMiddleware');
const { processReviewBatch } = require('../services/gamification');

/**
 * Review Endpoint
 * Processes a batch of vocabulary reviews and updates SRS data
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
        // Extract user ID from request (Firebase token or body)
        const userId = await extractUserId(req);

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Extract reviews array from request body
        const { reviews } = req.body;

        if (!reviews || !Array.isArray(reviews)) {
            return res.status(400).json({ 
                error: 'Reviews array is required',
                expectedFormat: '[{ wordId: "word", quality: 0-5 }, ...]'
            });
        }

        if (reviews.length === 0) {
            return res.status(400).json({ error: 'Reviews array cannot be empty' });
        }

        // Validate review format
        const invalidReview = reviews.find(r => !r.wordId || r.quality === undefined || r.quality < 0 || r.quality > 5);
        if (invalidReview) {
            return res.status(400).json({ 
                error: 'Invalid review format',
                expectedFormat: 'Each review must have { wordId: string, quality: 0-5 }',
                invalidReview
            });
        }

        console.log(`📝 Processing ${reviews.length} reviews for user: ${userId}`);

        // Process the review batch
        const result = await processReviewBatch(userId, reviews);

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Reviews processed successfully',
            userId: userId,
            reviewsProcessed: result.reviewsProcessed
        });

    } catch (error) {
        console.error('❌ Review processing error:', error.message);
        res.status(500).json({
            error: 'Failed to process reviews',
            details: error.message
        });
    }
};
