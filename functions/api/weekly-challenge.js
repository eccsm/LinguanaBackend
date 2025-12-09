const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');



// Weekly puzzle settings
const WEEKLY_PUZZLE_CONFIG = {
    wordsPerPuzzle: 12,
    lettersInWheel: 6,
    hintCost: 5,
    completionReward: 50,
    leaderboardPrizes: { 1: 200, 2: 100, 3: 50 }
};

function getCurrentPuzzleId() {
    const today = new Date();
    // Calculate start of the week (Monday) - same as handleWeeklyChallenge
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(today.setDate(diff));
    return monday.toISOString().split('T')[0];
}

function latinize(text) {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z]/g, '')
        .toUpperCase();
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

        // Debug logging
        console.log('[WEEKLY-SUBMIT] Looking for word:', guessWord);
        console.log('[WEEKLY-SUBMIT] Puzzle words:', puzzle.words.map(w => `${w.word} -> ${latinize(w.word)}`));

        const validWord = puzzle.words.find(w => latinize(w.word) === guessWord);

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

async function generateWeeklyPuzzleWords() {
    try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');

        console.log('[WEEKLY-PUZZLE] Generating MIXED-LANGUAGE puzzle words...');
        const prompt = `Generate a multilingual Wordscapes-style crossword puzzle.
Requirements:
1. Pick a 6-7 letter "root word" (e.g. "LISTEN", "BANANA") in English, Spanish, French, German, Italian, Portuguese, or Turkish.
2. The "letters" pool must be the scrambled letters of this root word.
3. Find 10-15 valid words that can be formed using ONLY the letters in the pool.
4. **CRITICAL:** The words can be from ANY of these languages: English, Spanish, French, German, Italian, Portuguese, Turkish. Mix them up!
5. Arrange these words into a connected crossword grid (max 8x10).
6. Words must be 3-7 letters long.
7. No slang, no offensive words.

Return JSON format ONLY:
{
  "letters": ["S", "T", "E", "P", "S", "E"],
  "words": [
    {"word": "STEPS", "lang": "en", "row": 4, "col": 2, "direction": "H", "points": 10},
    {"word": "HOLA", "lang": "es", "row": 2, "col": 4, "direction": "V", "points": 5},
    {"word": "EVET", "lang": "tr", "row": 5, "col": 5, "direction": "H", "points": 8}
  ]
}
Note: "direction" should be "H" (Horizontal) or "V" (Vertical). Row/Col are 0-indexed.`;

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

        puzzle.letters = puzzle.letters.map(l => latinize(l).charAt(0).toUpperCase());
        puzzle.words = puzzle.words.map(w => ({
            word: latinize(w.word).toUpperCase(),
            lang: w.lang || 'en',
            row: w.row,
            col: w.col,
            direction: w.direction,
            points: w.points || (w.word.length <= 3 ? 8 : w.word.length <= 4 ? 10 : w.word.length <= 5 ? 15 : 25)
        }));

        // Validate grid - ensure no conflicting letters at overlapping cells
        const validatedWords = [];
        const occupiedCells = {}; // key: "row,col" -> letter

        for (const w of puzzle.words) {
            let r = w.row;
            let c = w.col;
            const isHoriz = w.direction === 'H';
            let isValid = true;

            // Check if this word conflicts with existing cells
            for (let i = 0; i < w.word.length; i++) {
                const key = `${r},${c}`;
                const letter = w.word[i];

                if (occupiedCells[key] && occupiedCells[key] !== letter) {
                    console.log(`[PUZZLE-VALIDATE] Conflict at ${key}: existing=${occupiedCells[key]}, new=${letter} from word ${w.word}`);
                    isValid = false;
                    break;
                }

                if (isHoriz) c++; else r++;
            }

            if (isValid) {
                // Mark cells as occupied
                r = w.row;
                c = w.col;
                for (let i = 0; i < w.word.length; i++) {
                    const key = `${r},${c}`;
                    occupiedCells[key] = w.word[i];
                    if (isHoriz) c++; else r++;
                }
                validatedWords.push(w);
            }
        }

        console.log(`[PUZZLE-VALIDATE] Valid words: ${validatedWords.length}/${puzzle.words.length}`);
        puzzle.words = validatedWords;

        return puzzle;
    } catch (error) {
        console.error('[WEEKLY-PUZZLE] Error:', error.message);
        throw error;
    }
}

async function handleWeeklyChallenge(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const today = new Date();
        // Calculate start of the week (Monday)
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        const monday = new Date(today.setDate(diff));
        const puzzleDate = monday.toISOString().split('T')[0];

        // Single global cache key for everyone
        const puzzleId = puzzleDate;

        const db = admin.firestore();
        const puzzleRef = db.collection('weeklyPuzzleCache').doc(puzzleId);
        const puzzleDoc = await puzzleRef.get();

        let puzzleData;

        if (puzzleDoc.exists) {
            puzzleData = puzzleDoc.data();
        } else {
            // Generate new mixed-language puzzle
            const generated = await generateWeeklyPuzzleWords();
            puzzleData = {
                puzzleDate,
                ...generated,
                totalPoints: generated.words.reduce((sum, w) => sum + w.points, 0),
                generatedAt: FieldValue.serverTimestamp()
            };
            await puzzleRef.set(puzzleData);
        }

        // Get user progress - must match where handleWeeklySubmitWord saves
        const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleId}_${userId}`);
        const progressDoc = await progressRef.get();
        const userProgress = progressDoc.exists ? progressDoc.data() : { foundWords: [], score: 0, completed: false };

        res.json({
            success: true,
            puzzleId,
            letters: puzzleData.letters,
            wordCount: puzzleData.words.length,
            words: puzzleData.words, // Send full words with grid info
            config: WEEKLY_PUZZLE_CONFIG,
            userProgress
        });

    } catch (error) {
        console.error('Weekly challenge error:', error);
        res.status(500).json({ error: error.message });
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
