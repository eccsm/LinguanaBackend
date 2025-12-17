// require('dotenv').config();
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
app.all('/daily/reminder', dailyChallenge.handleDailyChallengeReminder);  // GET or POST for n8n
app.all('/daily/generate', dailyChallenge.handleGenerateDailyChallenge);  // GET or POST for n8n

// Weekly Challenge Routes
const weeklyChallenge = require('./api/weekly-challenge');
app.get('/weekly/challenge', weeklyChallenge.handleWeeklyChallenge);
app.post('/weekly/submit', weeklyChallenge.handleWeeklySubmitWord);
app.post('/weekly/hint', weeklyChallenge.handleWeeklyHint);
app.post('/weekly/tip', weeklyChallenge.handleWeeklyTip);   // Tips with meaning/translation
app.get('/weekly/leaderboard', weeklyChallenge.handleWeeklyLeaderboard);
app.get('/weekly/generate', weeklyChallenge.handleGenerateWordPuzzle);
app.post('/weekly/curated', weeklyChallenge.handleCuratedWords);  // n8n curated words endpoint
app.all('/weekly/award-winner', weeklyChallenge.handleWeeklyAwardWinner);  // n8n award winners
app.post('/weekly/clear-reward', weeklyChallenge.handleClearWeeklyReward);  // Clear pending reward

// Expedition Map Routes (Dynamic weekly map configuration)
const expeditionMap = require('./api/expedition-map');
app.get('/expedition/map', expeditionMap.handleGetExpeditionMap);

// Leaderboard Routes
const leaderboard = require('./api/leaderboard');
app.get('/daily/leaderboard', leaderboard.handleLeaderboard);
app.all('/daily/award-winner', leaderboard.handleAwardWinner);  // GET or POST for n8n

// League Routes (Smart matching with real + mock users)
const leagueService = require('./api/league-service');
app.post('/league/get-league', leagueService.handleGetLeague);
app.post('/league/update-profile', leagueService.handleUpdateLeagueProfile);
app.all('/league/process-weekly', leagueService.handleProcessWeeklyResults);  // n8n weekly trigger

// Speed Swipe Routes (Dynamic word pairs from Firestore)
const swipeService = require('./api/swipe-service');
app.all('/swipe/refresh', swipeService.handleRefreshWords);  // n8n daily refresh
app.get('/swipe/words', swipeService.handleGetWords);        // Fetch game words
app.get('/swipe/stats', swipeService.handleGetStats);        // Monitor word counts

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
app.all('/app-ads.txt', wrapHandler('./api/app-ads'));

// Export the Express app as a Cloud Function named 'api'
const { onRequest } = require('firebase-functions/v2/https');

// Export the Express app as a Cloud Function named 'api'
exports.api = onRequest({
    cors: true,
    invoker: 'public',
    secrets: [
        'ELEVENLABS_API_KEY',
        'APP_CLIENT_SECRET',
        'GOOGLE_WEB_CLIENT_ID',
        'OPENAI_API_KEY',
        'N8N_WEBHOOK_SECRET'
    ]
}, app);
