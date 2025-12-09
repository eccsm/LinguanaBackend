const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Weekly puzzle settings
const WEEKLY_PUZZLE_CONFIG = {
    wordsPerPuzzle: 12,
    lettersInWheel: 6,
    hintCost: 5,
    completionReward: 50,
    leaderboardPrizes: { 1: 200, 2: 100, 3: 50 }
};

function getCurrentPuzzleId() {
    return new Date().toISOString().split('T')[0];
}

function latinize(text) {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z]/g, '')
        .toUpperCase();
}

async function generateWeeklyPuzzleWords() {
    try {
        console.log('[WEEKLY-PUZZLE] Generating puzzle words...');
        const prompt = `Generate a word puzzle for a game like Wordscapes.
Requirements:
1. Choose 6 DIFFERENT letters that can form many English words
2. At least one vowel (A, E, I, O, U)
3. Common letters work better (E, A, R, S, T, N, etc.)
4. Generate 12-15 valid English words that can be made from ONLY these 6 letters
5. Words must be 3-7 letters long
6. Each letter can only be used ONCE per word
7. Only common, appropriate words (no slang, no offensive)
Return JSON format ONLY:
{
  "letters": ["S", "T", "E", "P", "S", "E"],
  "words": [
    {"word": "STEP", "points": 10},
    {"word": "PEST", "points": 10}
  ]
}`;

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'Generate word puzzles. Return ONLY valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.9,
                max_tokens: 2000,
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const content = response.data.choices[0].message.content.trim();
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) throw new Error('Failed to extract JSON');

        const puzzle = JSON.parse(jsonMatch[0]);

        puzzle.letters = puzzle.letters.map(l => latinize(l).charAt(0));
        puzzle.words = puzzle.words.map(w => ({
            word: latinize(w.word),
            points: w.points || (w.word.length <= 3 ? 8 : w.word.length <= 4 ? 10 : w.word.length <= 5 ? 15 : 25)
        }));

        return puzzle;
    } catch (error) {
        console.error('[WEEKLY-PUZZLE] Error:', error.message);
        throw error;
    }
}

async function handleWeeklyChallenge(req, res) {
    try {
        const { userId } = req.query;
        const puzzleDate = getCurrentPuzzleId();
        const db = admin.firestore();

        const cacheRef = db.collection('weeklyPuzzleCache').doc(puzzleDate);
        let puzzleData = (await cacheRef.get()).data();

        if (!puzzleData) {
            const puzzle = await generateWeeklyPuzzleWords();
            puzzleData = {
                puzzleDate,
                letters: puzzle.letters,
                words: puzzle.words,
                totalPoints: puzzle.words.reduce((sum, w) => sum + w.points, 0),
                generatedAt: FieldValue.serverTimestamp(),
            };
            await cacheRef.set(puzzleData);
        }

        let userProgress = null;
        if (userId) {
            const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`);
            const progressDoc = await progressRef.get();
            if (progressDoc.exists) userProgress = progressDoc.data();
        }

        return res.status(200).json({
            success: true,
            puzzleDate,
            letters: puzzleData.letters,
            wordCount: puzzleData.words.length,
            totalPoints: puzzleData.totalPoints,
            config: WEEKLY_PUZZLE_CONFIG,
            userProgress: userProgress ? {
                foundWords: userProgress.foundWords || [],
                score: userProgress.score || 0,
                hintsUsed: userProgress.hintsUsed || 0,
                completed: userProgress.completed || false,
            } : null,
        });
    } catch (error) {
        console.error('[WEEKLY-CHALLENGE] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function handleWeeklySubmitWord(req, res) {
    try {
        const { userId, word } = req.body;
        const puzzleDate = getCurrentPuzzleId();
        const db = admin.firestore();

        if (!userId || !word) return res.status(400).json({ success: false, error: 'Missing userId or word' });

        const guessWord = latinize(word);
        const cacheRef = db.collection('weeklyPuzzleCache').doc(puzzleDate);
        const puzzleDoc = await cacheRef.get();

        if (!puzzleDoc.exists) return res.status(404).json({ success: false, error: 'Puzzle not found' });

        const puzzle = puzzleDoc.data();
        const validWord = puzzle.words.find(w => w.word === guessWord);

        if (!validWord) return res.status(200).json({ success: true, valid: false, message: 'Word not in puzzle' });

        const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`);
        const progressDoc = await progressRef.get();
        let progress = progressDoc.exists ? progressDoc.data() : null;

        if (!progress) {
            const userDoc = await db.collection('users').doc(userId).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            progress = {
                puzzleDate, userId,
                displayName: userData.displayName || userData.username || 'Anonymous',
                avatar: userData.equippedAvatar || null,
                foundWords: [], score: 0, hintsUsed: 0, completed: false,
                startedAt: FieldValue.serverTimestamp(),
            };
        }

        if (progress.foundWords.includes(guessWord)) {
            return res.status(200).json({ success: true, valid: true, alreadyFound: true });
        }

        progress.foundWords.push(guessWord);
        progress.score += validWord.points;
        progress.completed = progress.foundWords.length >= puzzle.words.length;

        if (progress.completed && !progress.completedAt) {
            progress.completedAt = FieldValue.serverTimestamp();
        }

        await progressRef.set(progress, { merge: true });

        return res.status(200).json({
            success: true, valid: true, word: guessWord, points: validWord.points,
            totalScore: progress.score, wordsFound: progress.foundWords.length,
            totalWords: puzzle.words.length, completed: progress.completed,
        });
    } catch (error) {
        console.error('[WEEKLY-SUBMIT] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function handleWeeklyHint(req, res) {
    try {
        const { userId } = req.body;
        const puzzleDate = getCurrentPuzzleId();
        const db = admin.firestore();

        if (!userId) return res.status(400).json({ success: false, error: 'Missing userId' });

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ success: false, error: 'User not found' });

        const user = userDoc.data();
        if ((user.gems || 0) < WEEKLY_PUZZLE_CONFIG.hintCost) {
            return res.status(400).json({ success: false, error: 'Not enough gems', required: WEEKLY_PUZZLE_CONFIG.hintCost });
        }

        const puzzleDoc = await db.collection('weeklyPuzzleCache').doc(puzzleDate).get();
        const progressDoc = await db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`).get();

        if (!puzzleDoc.exists) return res.status(404).json({ success: false, error: 'Puzzle not found' });

        const puzzle = puzzleDoc.data();
        const progress = progressDoc.exists ? progressDoc.data() : { foundWords: [] };
        const undiscovered = puzzle.words.filter(w => !progress.foundWords.includes(w.word));

        if (undiscovered.length === 0) return res.status(400).json({ success: false, error: 'All words found' });

        const hintWord = undiscovered[Math.floor(Math.random() * undiscovered.length)];

        await userRef.update({ gems: FieldValue.increment(-WEEKLY_PUZZLE_CONFIG.hintCost) });

        const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`);
        await progressRef.set({
            puzzleDate, userId,
            foundWords: [...progress.foundWords, hintWord.word],
            score: (progress.score || 0) + Math.floor(hintWord.points / 2),
            hintsUsed: (progress.hintsUsed || 0) + 1,
            startedAt: progress.startedAt || FieldValue.serverTimestamp(),
        }, { merge: true });

        return res.status(200).json({
            success: true, hintWord: hintWord.word,
            gemsCost: WEEKLY_PUZZLE_CONFIG.hintCost,
            gemsRemaining: (user.gems || 0) - WEEKLY_PUZZLE_CONFIG.hintCost,
        });
    } catch (error) {
        console.error('[WEEKLY-HINT] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function handleWeeklyLeaderboard(req, res) {
    try {
        const { puzzleDate: requestedWeek, limit = 50 } = req.query;
        const puzzleDate = requestedWeek || getCurrentPuzzleId();
        const db = admin.firestore();

        const snapshot = await db.collection('weeklyPuzzleScores')
            .where('puzzleDate', '==', puzzleDate)
            .orderBy('score', 'desc')
            .orderBy('completedAt', 'asc')
            .limit(parseInt(limit))
            .get();

        const leaderboard = snapshot.docs.map((doc, index) => {
            const data = doc.data();
            return {
                rank: index + 1,
                userId: data.userId,
                displayName: data.displayName || 'Anonymous',
                avatar: data.avatar || null,
                score: data.score,
                wordsFound: data.foundWords?.length || 0,
                completed: data.completed || false,
            };
        });

        return res.status(200).json({
            success: true, puzzleDate, leaderboard,
            prizes: WEEKLY_PUZZLE_CONFIG.leaderboardPrizes,
        });
    } catch (error) {
        console.error('[WEEKLY-LEADERBOARD] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function handleGenerateWordPuzzle(req, res) {
    try {
        const webhookSecret = req.headers['x-webhook-secret'] || req.headers['x-client-secret'];
        if (webhookSecret !== process.env.N8N_WEBHOOK_SECRET && webhookSecret !== process.env.APP_CLIENT_SECRET) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const daysAhead = parseInt(req.query.daysAhead || '1', 10);
        const db = admin.firestore();
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + daysAhead);
        const dateStr = targetDate.toISOString().split('T')[0];

        const cacheRef = db.collection('weeklyPuzzleCache').doc(dateStr);
        const cacheDoc = await cacheRef.get();

        if (cacheDoc.exists) {
            return res.status(200).json({ success: true, status: 'already_cached', date: dateStr });
        }

        const puzzle = await generateWeeklyPuzzleWords();

        await cacheRef.set({
            puzzleDate: dateStr,
            letters: puzzle.letters,
            words: puzzle.words,
            totalPoints: puzzle.words.reduce((sum, w) => sum + w.points, 0),
            generatedAt: FieldValue.serverTimestamp(),
            preGenerated: true,
        });

        return res.status(200).json({
            success: true, status: 'generated', date: dateStr,
            letters: puzzle.letters.join(''), wordCount: puzzle.words.length,
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    handleWeeklyChallenge,
    handleWeeklySubmitWord,
    handleWeeklyHint,
    handleWeeklyLeaderboard,
    handleGenerateWordPuzzle
};
