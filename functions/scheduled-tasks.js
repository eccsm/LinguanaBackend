const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { initializeFirebase } = require('./utils/firebaseInit');

const admin = initializeFirebase();

const dailyChallenge = require('./api/daily-challenge');
const weeklyChallenge = require('./api/weekly-challenge');
const leaderboard = require('./api/leaderboard');
const leagueService = require('./api/league-service');

/**
 * Run an existing Express handler from a trusted scheduled function.
 *
 * Reusing the handlers keeps scheduled jobs and HTTP endpoints on the same
 * Firestore schema while avoiding a public HTTP round trip.
 */
async function invokeHandler(handler, { query = {}, body = {} } = {}) {
    const schedulerSecret = process.env.N8N_WEBHOOK_SECRET;
    if (!schedulerSecret) {
        throw new Error('N8N_WEBHOOK_SECRET is missing');
    }

    let statusCode = 200;
    let responseBody;
    let responseSent = false;

    const req = {
        method: 'SCHEDULED',
        headers: {
            'x-webhook-secret': schedulerSecret,
        },
        query,
        body,
    };

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(payload) {
            responseBody = payload;
            responseSent = true;
            return this;
        },
        send(payload) {
            responseBody = payload;
            responseSent = true;
            return this;
        },
    };

    await handler(req, res);

    if (!responseSent) {
        throw new Error('Scheduled handler completed without a response');
    }

    if (statusCode >= 400 || responseBody?.success === false) {
        const details = responseBody?.error || responseBody?.details || JSON.stringify(responseBody);
        throw new Error(`Scheduled handler failed (${statusCode}): ${details}`);
    }

    return responseBody;
}

/**
 * Acquire a short Firestore lease before a non-repeatable scheduled task.
 * Award handlers are already idempotent after a successful batch commit; this
 * lease also protects the read-before-write window from overlapping triggers.
 */
async function runWithLease(runId, task) {
    const db = admin.firestore();
    const runRef = db.collection('scheduledTaskRuns').doc(runId);
    const nowMs = Date.now();
    const leaseUntilMs = nowMs + (10 * 60 * 1000);

    const acquired = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(runRef);
        const existing = snapshot.exists ? snapshot.data() : null;

        if (existing?.status === 'completed') {
            return false;
        }

        if (existing?.status === 'running' && existing.leaseUntilMs > nowMs) {
            return false;
        }

        transaction.set(runRef, {
            status: 'running',
            leaseUntilMs,
            attempts: admin.firestore.FieldValue.increment(1),
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return true;
    });

    if (!acquired) {
        logger.info('Scheduled task skipped because it is complete or already running', { runId });
        return { skipped: true, runId };
    }

    try {
        const result = await task();
        await runRef.set({
            status: 'completed',
            leaseUntilMs: 0,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return result;
    } catch (error) {
        await runRef.set({
            status: 'failed',
            leaseUntilMs: 0,
            lastError: String(error.message || error).slice(0, 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        throw error;
    }
}

function getPreviousUtcDate() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().split('T')[0];
}

function getCurrentUtcDate() {
    return new Date().toISOString().split('T')[0];
}

function getPreviousWeekId() {
    const today = new Date();
    const utcDay = today.getUTCDay();
    const daysFromMonday = utcDay === 0 ? 6 : utcDay - 1;
    const thisMonday = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - daysFromMonday
    ));
    thisMonday.setUTCDate(thisMonday.getUTCDate() - 7);
    return thisMonday.toISOString().split('T')[0];
}

const commonScheduleOptions = {
    region: 'us-central1',
    timeZone: 'UTC',
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
};

/**
 * Pre-generate both game types before the UTC day changes.
 *
 * Generating today as well as tomorrow repairs a missing cache automatically.
 * Existing cache documents make every call idempotent.
 */
exports.generateGameContent = onSchedule({
    ...commonScheduleOptions,
    schedule: '30 23 * * *',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: ['N8N_WEBHOOK_SECRET', 'OPENAI_API_KEY'],
}, async () => {
    const jobs = [
        ['daily-today', dailyChallenge.handleGenerateDailyChallenge, { query: { daysAhead: '0' } }],
        ['daily-tomorrow', dailyChallenge.handleGenerateDailyChallenge, { query: { daysAhead: '1' } }],
        ['weekly-today', weeklyChallenge.handleGenerateWordPuzzle, { query: { daysAhead: '0' } }],
        ['weekly-tomorrow', weeklyChallenge.handleGenerateWordPuzzle, { query: { daysAhead: '1' } }],
    ];

    const results = {};
    for (const [name, handler, request] of jobs) {
        results[name] = await invokeHandler(handler, request);
    }

    logger.info('Scheduled game content generation completed', results);
});

/**
 * Award the previous day's Daily Challenge leaderboard.
 */
exports.awardDailyWinners = onSchedule({
    ...commonScheduleOptions,
    schedule: '10 0 * * *',
    timeoutSeconds: 180,
    secrets: ['N8N_WEBHOOK_SECRET'],
}, async () => {
    const targetDate = getPreviousUtcDate();
    const result = await runWithLease(`award-daily-${targetDate}`, () =>
        invokeHandler(leaderboard.handleAwardWinner, { query: { date: targetDate } })
    );
    logger.info('Scheduled daily awards completed', result);
});

/**
 * Award the previous week's aggregate puzzle leaderboard every Monday.
 */
exports.awardWeeklyWinners = onSchedule({
    ...commonScheduleOptions,
    schedule: '20 0 * * 1',
    timeoutSeconds: 300,
    secrets: ['N8N_WEBHOOK_SECRET'],
}, async () => {
    const weekId = getPreviousWeekId();
    const result = await runWithLease(`award-weekly-${weekId}`, () =>
        invokeHandler(weeklyChallenge.handleWeeklyAwardWinner, { query: { weekId } })
    );
    logger.info('Scheduled weekly awards completed', result);
});

/**
 * Remind users who have not completed today's Daily Challenge.
 * Retries are disabled because FCM delivery cannot be rolled back safely.
 */
exports.sendDailyChallengeReminders = onSchedule({
    ...commonScheduleOptions,
    schedule: '0 17 * * *',
    retryCount: 0,
    timeoutSeconds: 300,
    secrets: ['N8N_WEBHOOK_SECRET'],
}, async () => {
    const date = getCurrentUtcDate();
    const result = await runWithLease(`notify-daily-challenge-${date}`, () =>
        invokeHandler(dailyChallenge.handleDailyChallengeReminder, {
            query: { type: 'challenge' },
        })
    );
    logger.info('Scheduled Daily Challenge reminders completed', result);
});

/**
 * Remind users with an active streak who have not practiced today.
 */
exports.sendStreakReminders = onSchedule({
    ...commonScheduleOptions,
    schedule: '0 20 * * *',
    retryCount: 0,
    timeoutSeconds: 300,
    secrets: ['N8N_WEBHOOK_SECRET'],
}, async () => {
    const date = getCurrentUtcDate();
    const result = await runWithLease(`notify-streak-${date}`, () =>
        invokeHandler(dailyChallenge.handleDailyChallengeReminder, {
            query: { type: 'streak' },
        })
    );
    logger.info('Scheduled streak reminders completed', result);
});

/**
 * Finalize the current ISO league week shortly before the UTC week changes.
 * The existing handler sends FCM only when a user's league tier changes.
 */
exports.processWeeklyLeagueResults = onSchedule({
    ...commonScheduleOptions,
    schedule: '40 23 * * 0',
    retryCount: 0,
    timeoutSeconds: 540,
    secrets: ['N8N_WEBHOOK_SECRET'],
}, async () => {
    const weekId = leagueService.getWeekId();
    const result = await runWithLease(`league-results-${weekId}`, () =>
        invokeHandler(leagueService.handleProcessWeeklyResults)
    );
    logger.info('Scheduled weekly league processing completed', result);
});

exports.invokeHandler = invokeHandler;
