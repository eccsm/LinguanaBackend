require('dotenv').config();
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

// Initialize Firebase Admin once
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const app = express();

// Enable CORS for all routes
app.use(cors({ origin: true }));

// Parse JSON bodies
app.use(express.json());

// Helper to wrap Vercel-style handlers for Express
const wrapHandler = (handlerPath) => {
    const handler = require(handlerPath);
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            console.error(`Error in ${handlerPath}:`, error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal Server Error', details: error.message });
            }
        }
    };
};

// Daily Challenge Routes
const dailyChallenge = require('./api/daily-challenge');
app.get('/daily/challenge', dailyChallenge.handleChallenge);
app.post('/daily/submit', dailyChallenge.handleSubmitScore);
app.get('/daily/reminder', dailyChallenge.handleDailyChallengeReminder);

// Weekly Challenge Routes
const weeklyChallenge = require('./api/weekly-challenge');
app.get('/weekly/challenge', weeklyChallenge.handleWeeklyChallenge);
app.post('/weekly/submit', weeklyChallenge.handleWeeklySubmitWord);
app.post('/weekly/hint', weeklyChallenge.handleWeeklyHint);
app.get('/weekly/leaderboard', weeklyChallenge.handleWeeklyLeaderboard);
app.get('/weekly/generate', weeklyChallenge.handleGenerateWordPuzzle);

// Leaderboard Routes
const leaderboard = require('./api/leaderboard');
app.get('/daily/leaderboard', leaderboard.handleLeaderboard);
app.get('/daily/award-winner', leaderboard.handleAwardWinner);

// Other Routes
app.all('/chat', wrapHandler('./api/chat'));
app.all('/create-profile', wrapHandler('./api/create-profile'));
app.all('/transcribe', wrapHandler('./api/transcribe'));
app.all('/speak', wrapHandler('./api/speak'));
app.all('/user-activity', wrapHandler('./api/user-activity'));
app.all('/lesson-complete', wrapHandler('./api/lesson-complete'));
app.all('/review', wrapHandler('./api/review'));
app.all('/extract-vocabulary', wrapHandler('./api/extract-vocabulary'));
app.all('/grant-rewards', wrapHandler('./api/grant-rewards'));
app.all('/app-ads', wrapHandler('./api/app-ads'));

// Export the Express app as a Cloud Function named 'api'
const { onRequest } = require('firebase-functions/v2/https');

// Export the Express app as a Cloud Function named 'api'
exports.api = onRequest({ cors: true, invoker: 'public' }, app);
