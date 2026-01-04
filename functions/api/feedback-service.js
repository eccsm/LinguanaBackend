/**
 * User feedback endpoint - collects user feedback and stores in Firestore
 * Can also send to external webhook (e.g., Slack, Discord, n8n)
 */

const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const { FieldValue } = require('firebase-admin/firestore');

async function handleSubmitFeedback(req, res) {
    try {
        const { userId, type, message, rating, metadata = {} } = req.body;

        if (!userId || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId and message are required'
            });
        }

        // Validate feedback type
        const validTypes = ['bug', 'feature', 'general', 'complaint', 'praise'];
        const feedbackType = validTypes.includes(type) ? type : 'general';

        // Validate rating if provided
        let feedbackRating = null;
        if (rating !== undefined && rating !== null) {
            const parsedRating = parseInt(rating, 10);
            if (parsedRating >= 1 && parsedRating <= 5) {
                feedbackRating = parsedRating;
            }
        }

        const db = admin.firestore();

        // Get user info for context
        let userInfo = {};
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                userInfo = {
                    username: userData.username || null,
                    email: userData.email || null,
                    isPro: userData.isPro || false,
                    createdAt: userData.createdAt || null,
                    totalConversations: userData.totalConversations || 0,
                };
            }
        } catch (err) {
            console.error('[FEEDBACK] Error fetching user info:', err);
        }

        // Create feedback document
        const feedbackData = {
            userId,
            userInfo,
            type: feedbackType,
            message: message.trim(),
            rating: feedbackRating,
            metadata: {
                ...metadata,
                platform: metadata.platform || 'mobile',
                appVersion: metadata.appVersion || 'unknown',
            },
            status: 'new', // new, read, resolved, closed
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        const feedbackRef = await db.collection('userFeedback').add(feedbackData);

        console.log(`[FEEDBACK] New feedback submitted: ${feedbackRef.id}`, {
            type: feedbackType,
            userId,
            hasRating: feedbackRating !== null
        });

        // Optional: Send to n8n webhook for Slack/Discord notification
        const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
        if (webhookUrl) {
            try {
                const axios = require('axios');
                await axios.post(webhookUrl, {
                    feedbackId: feedbackRef.id,
                    ...feedbackData,
                    createdAt: new Date().toISOString(), // Can't send FieldValue over webhook
                });
                console.log('[FEEDBACK] Sent to webhook successfully');
            } catch (webhookError) {
                console.error('[FEEDBACK] Webhook notification failed:', webhookError.message);
                // Don't fail the request if webhook fails
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Thank you for your feedback!',
            feedbackId: feedbackRef.id
        });

    } catch (error) {
        console.error('[FEEDBACK] Error submitting feedback:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to submit feedback. Please try again.'
        });
    }
}

/**
 * Get feedback for admin dashboard (optional)
 */
async function handleGetFeedback(req, res) {
    try {
        const webhookSecret = req.headers['x-webhook-secret'] || req.headers['x-client-secret'];
        if (webhookSecret !== process.env.N8N_WEBHOOK_SECRET && webhookSecret !== process.env.APP_CLIENT_SECRET) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const { status, type, limit = 50 } = req.query;
        const db = admin.firestore();

        let query = db.collection('userFeedback')
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit, 10));

        if (status) {
            query = query.where('status', '==', status);
        }
        if (type) {
            query = query.where('type', '==', type);
        }

        const snapshot = await query.get();
        const feedbackList = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
        }));

        return res.status(200).json({
            success: true,
            count: feedbackList.length,
            feedback: feedbackList
        });

    } catch (error) {
        console.error('[FEEDBACK] Error fetching feedback:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    handleSubmitFeedback,
    handleGetFeedback
};
