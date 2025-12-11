const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');



// Weekly puzzle settings
const WEEKLY_PUZZLE_CONFIG = {
    wordsPerPuzzle: 12,
    lettersInWheel: 6,
    hintCost: 5,      // Gems to reveal a word completely
    tipCost: 2,       // Gems to show meaning/translation hint
    completionReward: 50,
    leaderboardPrizes: { 1: 200, 2: 100, 3: 50 }
};

function getCurrentPuzzleId() {
    // Returns TODAY's date as the puzzle ID (daily puzzles)
    const today = new Date();
    const utcYear = today.getUTCFullYear();
    const utcMonth = today.getUTCMonth();
    const utcDate = today.getUTCDate();
    return new Date(Date.UTC(utcYear, utcMonth, utcDate)).toISOString().split('T')[0];
}

function getCurrentWeekId() {
    // Returns Monday of current week for weekly aggregation
    const today = new Date();
    const utcYear = today.getUTCFullYear();
    const utcMonth = today.getUTCMonth();
    const utcDate = today.getUTCDate();
    const utcDay = today.getUTCDay(); // 0=Sunday, 1=Monday, ... 6=Saturday

    const daysFromMonday = utcDay === 0 ? 6 : utcDay - 1;
    const mondayDate = utcDate - daysFromMonday;
    return new Date(Date.UTC(utcYear, utcMonth, mondayDate)).toISOString().split('T')[0];
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
        const weekId = getCurrentWeekId();
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
                puzzleDate, userId, weekId,
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

        // Update weekly aggregated score
        const weeklyScoreRef = db.collection('weeklyAggregatedScores').doc(`${weekId}_${userId}`);
        const weeklyScoreDoc = await weeklyScoreRef.get();

        if (weeklyScoreDoc.exists) {
            // Increment existing score
            await weeklyScoreRef.update({
                totalScore: FieldValue.increment(validWord.points),
                lastUpdated: FieldValue.serverTimestamp(),
            });
        } else {
            // Create new weekly score record
            const userDoc = await db.collection('users').doc(userId).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            await weeklyScoreRef.set({
                weekId,
                userId,
                displayName: userData.displayName || userData.username || 'Anonymous',
                avatar: userData.equippedAvatar || null,
                totalScore: validWord.points,
                createdAt: FieldValue.serverTimestamp(),
                lastUpdated: FieldValue.serverTimestamp(),
            });
        }

        // Get updated weekly score
        const updatedWeeklyDoc = await weeklyScoreRef.get();
        const weeklyScore = updatedWeeklyDoc.exists ? updatedWeeklyDoc.data().totalScore : validWord.points;

        return res.status(200).json({
            success: true, valid: true, word: guessWord, points: validWord.points,
            totalScore: progress.score, wordsFound: progress.foundWords.length,
            totalWords: puzzle.words.length, completed: progress.completed,
            weeklyScore, // Include weekly aggregate
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
1. Pick a 7-8 letter "root word" (e.g. "ORATION", "CREATION") in English, Spanish, French, German, Italian, Portuguese, or Turkish.
2. The "letters" pool must be the scrambled letters of this root word.
3. Find 8-12 valid words that can be formed using ONLY the letters in the pool.
4. The words can be from ANY of these languages: English, Spanish, French, German, Italian, Portuguese, Turkish. Mix them up!
5. Words must be 3-7 letters long.
6. No slang, no offensive words.

**CRITICAL CONNECTIVITY RULES:**
- ALL words must be connected like a real crossword puzzle
- The first word (longest) should be placed horizontally in the middle of the grid (e.g., row 3, col 0)
- Each subsequent word MUST share at least one letter cell with an existing word
- Words crossing each other must have the SAME letter at the intersection point
- Plan intersections carefully: vertical words should cross horizontal words at shared letters
- Aim for a compact grid (max 8x8) with tight connections

Example of proper connectivity for "ORATION" letters:
- RATION at row 2, col 0, H (horizontal, the anchor word)
- RAIN at row 1, col 0, V (shares R at row 2, col 0)
- RIOT at row 2, col 3, V (shares I at row 2, col 3)
- ORAL at row 4, col 2, H (shares A at row 4, col 3)

Return JSON format ONLY:
{
  "letters": ["O", "R", "A", "T", "I", "O", "N"],
  "words": [
    {"word": "RATION", "lang": "en", "row": 2, "col": 0, "direction": "H", "points": 15},
    {"word": "RAIN", "lang": "en", "row": 1, "col": 0, "direction": "V", "points": 10},
    {"word": "RIOT", "lang": "en", "row": 2, "col": 3, "direction": "V", "points": 10},
    {"word": "ORAL", "lang": "en", "row": 4, "col": 2, "direction": "H", "points": 10},
    {"word": "ART", "lang": "en", "row": 3, "col": 2, "direction": "V", "points": 8},
    {"word": "TAN", "lang": "en", "row": 5, "col": 4, "direction": "H", "points": 8}
  ]
}
Note: "direction" is "H" (Horizontal) or "V" (Vertical). Row/Col are 0-indexed. Ensure ALL words connect!`;

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

        // Validate grid - ensure no conflicting letters and proper connectivity
        const validatedWords = [];
        const occupiedCells = {}; // key: "row,col" -> letter

        // Helper function to get all cells of a word
        const getWordCells = (word) => {
            const cells = [];
            let r = word.row;
            let c = word.col;
            const isHoriz = word.direction === 'H';
            for (let i = 0; i < word.word.length; i++) {
                cells.push({ row: r, col: c, letter: word.word[i] });
                if (isHoriz) c++; else r++;
            }
            return cells;
        };

        // Helper function to check if a word intersects with existing cells
        const hasIntersection = (word) => {
            const cells = getWordCells(word);
            for (const cell of cells) {
                const key = `${cell.row},${cell.col}`;
                if (occupiedCells[key] && occupiedCells[key] === cell.letter) {
                    return true; // Found a valid intersection
                }
            }
            return false;
        };

        // Helper function to check if word has conflicts
        const hasConflict = (word) => {
            const cells = getWordCells(word);
            for (const cell of cells) {
                const key = `${cell.row},${cell.col}`;
                if (occupiedCells[key] && occupiedCells[key] !== cell.letter) {
                    console.log(`[PUZZLE-VALIDATE] Conflict at ${key}: existing=${occupiedCells[key]}, new=${cell.letter} from word ${word.word}`);
                    return true;
                }
            }
            return false;
        };

        // Sort words by length (descending) to place longer words first
        const sortedWords = [...puzzle.words].sort((a, b) => b.word.length - a.word.length);

        for (let i = 0; i < sortedWords.length; i++) {
            const w = sortedWords[i];

            // Check for conflicts (different letter at same cell)
            if (hasConflict(w)) {
                console.log(`[PUZZLE-VALIDATE] Word ${w.word} conflicts with existing words - skipping`);
                continue;
            }

            // First word doesn't need intersection, subsequent words must intersect
            if (validatedWords.length > 0 && !hasIntersection(w)) {
                console.log(`[PUZZLE-VALIDATE] Word ${w.word} has no intersection with existing grid - skipping`);
                continue;
            }

            // Word is valid - add its cells to occupiedCells
            const cells = getWordCells(w);
            for (const cell of cells) {
                const key = `${cell.row},${cell.col}`;
                occupiedCells[key] = cell.letter;
            }
            validatedWords.push(w);
            console.log(`[PUZZLE-VALIDATE] Added word ${w.word} (${w.direction}) at ${w.row},${w.col}`);
        }

        console.log(`[PUZZLE-VALIDATE] Valid connected words: ${validatedWords.length}/${puzzle.words.length}`);

        // If too few words are valid, log a warning
        if (validatedWords.length < 6) {
            console.warn(`[PUZZLE-VALIDATE] Warning: Only ${validatedWords.length} valid words. Puzzle quality may be poor.`);
        }

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
        // Use UTC date for TODAY's puzzle (daily puzzles with weekly leaderboard)
        const utcYear = today.getUTCFullYear();
        const utcMonth = today.getUTCMonth();
        const utcDate = today.getUTCDate();
        const utcDay = today.getUTCDay();

        // Puzzle ID is TODAY's date
        const puzzleDate = new Date(Date.UTC(utcYear, utcMonth, utcDate)).toISOString().split('T')[0];
        const puzzleId = puzzleDate;

        // Calculate week ID for weekly aggregation (Monday of current week)
        const daysFromMonday = utcDay === 0 ? 6 : utcDay - 1;
        const mondayDate = utcDate - daysFromMonday;
        const weekMonday = new Date(Date.UTC(utcYear, utcMonth, mondayDate));
        const weekId = weekMonday.toISOString().split('T')[0];

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

        // Get user's daily progress
        const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleId}_${userId}`);
        const progressDoc = await progressRef.get();
        const userProgress = progressDoc.exists ? progressDoc.data() : { foundWords: [], revealedCells: [], score: 0, completed: false };

        // Get user's weekly aggregated score
        const weeklyScoreRef = db.collection('weeklyAggregatedScores').doc(`${weekId}_${userId}`);
        const weeklyScoreDoc = await weeklyScoreRef.get();
        const weeklyScore = weeklyScoreDoc.exists ? weeklyScoreDoc.data().totalScore : 0;

        // Add caching headers: 5 min client, 10 min CDN
        res.set('Cache-Control', 'public, max-age=300, s-maxage=600');

        res.json({
            success: true,
            puzzleId,
            weekId, // For weekly leaderboard reference
            letters: puzzleData.letters,
            wordCount: puzzleData.words.length,
            words: puzzleData.words,
            config: WEEKLY_PUZZLE_CONFIG,
            userProgress,
            weeklyScore, // Total score for this week
        });

    } catch (error) {
        console.error('Weekly challenge error:', error);
        res.status(500).json({ error: error.message });
    }
}

async function handleWeeklyHint(req, res) {
    try {
        const { userId, paidByAd } = req.body;
        const puzzleDate = getCurrentPuzzleId();
        const db = admin.firestore();

        if (!userId) return res.status(400).json({ success: false, error: 'Missing userId' });

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ success: false, error: 'User not found' });

        const user = userDoc.data();

        // Check XP unless paid by ad
        if (!paidByAd && (user.xp || 0) < WEEKLY_PUZZLE_CONFIG.hintCost) {
            return res.status(400).json({ success: false, error: 'Not enough XP', required: WEEKLY_PUZZLE_CONFIG.hintCost });
        }

        const puzzleDoc = await db.collection('weeklyPuzzleCache').doc(puzzleDate).get();
        const progressDoc = await db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`).get();

        if (!puzzleDoc.exists) return res.status(404).json({ success: false, error: 'Puzzle not found' });

        const puzzle = puzzleDoc.data();
        const progress = progressDoc.exists ? progressDoc.data() : { foundWords: [], revealedCells: [] };

        // Find all unrevealed cells in undiscovered words
        const unrevealedCells = [];
        const revealedSet = new Set(progress.revealedCells || []);

        puzzle.words.forEach(wordObj => {
            if (progress.foundWords.includes(wordObj.word)) return; // Skip found words

            // Check each letter cell of this word
            if (wordObj.direction === 'H') {
                for (let i = 0; i < wordObj.word.length; i++) {
                    const cellKey = `${wordObj.row},${wordObj.col + i}`;
                    if (!revealedSet.has(cellKey)) {
                        unrevealedCells.push({
                            row: wordObj.row,
                            col: wordObj.col + i,
                            letter: wordObj.word[i],
                            key: cellKey
                        });
                    }
                }
            } else {
                for (let i = 0; i < wordObj.word.length; i++) {
                    const cellKey = `${wordObj.row + i},${wordObj.col}`;
                    if (!revealedSet.has(cellKey)) {
                        unrevealedCells.push({
                            row: wordObj.row + i,
                            col: wordObj.col,
                            letter: wordObj.word[i],
                            key: cellKey
                        });
                    }
                }
            }
        });

        if (unrevealedCells.length === 0) return res.status(400).json({ success: false, error: 'All cells revealed' });

        // Pick one random unrevealed cell
        const targetCell = unrevealedCells[Math.floor(Math.random() * unrevealedCells.length)];

        // Deduct XP only if not paid by ad
        let xpCost = 0;
        if (!paidByAd) {
            xpCost = WEEKLY_PUZZLE_CONFIG.hintCost;
            await userRef.update({
                xp: FieldValue.increment(-xpCost)
            });
        }

        const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`);
        await progressRef.set({
            puzzleDate, userId,
            revealedCells: FieldValue.arrayUnion(targetCell.key),
            hintsUsed: (progress.hintsUsed || 0) + 1,
            startedAt: progress.startedAt || FieldValue.serverTimestamp(),
        }, { merge: true });

        return res.status(200).json({
            success: true,
            cell: { row: targetCell.row, col: targetCell.col, letter: targetCell.letter },
            xpCost,
            xpRemaining: (user.xp || 0) - xpCost,
        });
    } catch (error) {
        console.error('[WEEKLY-HINT] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Get a TIP for an unfound word - shows meaning/translation without revealing the word
 * POST /api/weekly/tip
 */
async function handleWeeklyTip(req, res) {
    try {
        const { userId, paidByAd } = req.body;
        const puzzleDate = getCurrentPuzzleId();
        const db = admin.firestore();

        if (!userId) return res.status(400).json({ success: false, error: 'Missing userId' });

        // Get user document
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ success: false, error: 'User not found' });

        const user = userDoc.data();
        const tipCost = WEEKLY_PUZZLE_CONFIG.tipCost || 250;

        // Check XP unless paid by ad
        if (!paidByAd && (user.xp || 0) < tipCost) {
            return res.status(400).json({
                success: false,
                error: 'Not enough XP',
                required: tipCost,
                current: user.xp || 0
            });
        }

        // Get puzzle and user progress
        const puzzleDoc = await db.collection('weeklyPuzzleCache').doc(puzzleDate).get();
        const progressDoc = await db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`).get();

        if (!puzzleDoc.exists) return res.status(404).json({ success: false, error: 'Puzzle not found' });

        const puzzle = puzzleDoc.data();
        const progress = progressDoc.exists ? progressDoc.data() : { foundWords: [], tipsUsed: [] };

        // Get user's native language (default to English)
        const nativeLanguage = user.nativeLanguage || 'en';

        // Map short codes to full language names for the meaning object
        const langCodeToName = {
            'en': 'English',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'tr': 'Turkish',
            'ru': 'Russian',
            'ar': 'Arabic',
            'hi': 'Hindi',
            'zh': 'Chinese',
            'ja': 'Japanese',
            'ko': 'Korean',
        };

        const nativeLangName = langCodeToName[nativeLanguage] || 'English';

        // Find unfound words that:
        // 1. Haven't been found yet
        // 2. Haven't had tips used on them
        // 3. Have meaning data
        const tipsUsed = progress.tipsUsed || [];
        const foundWords = progress.foundWords || [];

        const eligibleWords = puzzle.words.filter(w =>
            !foundWords.includes(w.word) &&
            !tipsUsed.includes(w.word) &&
            w.meaning && typeof w.meaning === 'object'
        );

        if (eligibleWords.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No tips available',
                message: 'All words have tips used or no meaning data'
            });
        }

        // Pick a random word to give tip for
        const tipWord = eligibleWords[Math.floor(Math.random() * eligibleWords.length)];

        // Get meaning in user's native language
        let meaningText = tipWord.meaning[nativeLangName] || tipWord.meaning['English'] || null;

        // If still no meaning, try first available translation
        if (!meaningText) {
            const availableKeys = Object.keys(tipWord.meaning);
            if (availableKeys.length > 0) {
                meaningText = tipWord.meaning[availableKeys[0]];
            }
        }

        if (!meaningText) {
            return res.status(400).json({ success: false, error: 'Meaning not available for this word' });
        }

        // Deduct XP only if not paid by ad
        let xpCost = 0;
        if (!paidByAd) {
            xpCost = tipCost;
            await userRef.update({
                xp: FieldValue.increment(-xpCost)
            });
        }

        // Mark this word as having a tip used
        const progressRef = db.collection('weeklyPuzzleScores').doc(`${puzzleDate}_${userId}`);
        await progressRef.set({
            puzzleDate,
            userId,
            tipsUsed: [...tipsUsed, tipWord.word],
            startedAt: progress.startedAt || FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`[WEEKLY-TIP] User ${userId} got tip for word in ${tipWord.lang}: "${meaningText}" (native: ${nativeLangName})`);

        return res.status(200).json({
            success: true,
            tip: {
                meaning: meaningText,
                wordLanguage: tipWord.lang,        // Original language of the word
                translationLanguage: nativeLangName, // Language the meaning is in
                wordLength: tipWord.word.length,   // Hint about word length
            },
            xpCost,
            xpRemaining: (user.xp || 0) - xpCost,
        });
    } catch (error) {
        console.error('[WEEKLY-TIP] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

async function handleWeeklyLeaderboard(req, res) {
    try {
        const { type = 'daily', limit = 50 } = req.query;
        // Cap limit to 50 to prevent excessive reads
        const safeLimit = Math.min(parseInt(limit) || 50, 50);
        const db = admin.firestore();

        // Add caching headers: 1 min client, 5 min CDN
        res.set('Cache-Control', 'public, max-age=60, s-maxage=300');

        if (type === 'weekly') {
            // Weekly aggregated leaderboard
            const weekId = getCurrentWeekId();

            let snapshot;
            try {
                snapshot = await db.collection('weeklyAggregatedScores')
                    .where('weekId', '==', weekId)
                    .orderBy('totalScore', 'desc')
                    .limit(safeLimit)
                    .get();
            } catch (indexError) {
                // If index doesn't exist yet, return empty leaderboard with helpful message
                console.warn('[WEEKLY-LEADERBOARD] Index not ready:', indexError.message);
                return res.status(200).json({
                    success: true,
                    type: 'weekly',
                    weekId,
                    leaderboard: [],
                    prizes: WEEKLY_PUZZLE_CONFIG.leaderboardPrizes,
                    message: 'Leaderboard index is being created. Check back soon!',
                });
            }

            const leaderboard = snapshot.docs.map((doc, index) => {
                const data = doc.data();
                return {
                    rank: index + 1,
                    userId: data.userId,
                    displayName: data.displayName || 'Anonymous',
                    avatar: data.avatar || null,
                    score: data.totalScore,
                };
            });

            return res.status(200).json({
                success: true,
                type: 'weekly',
                weekId,
                leaderboard,
                prizes: WEEKLY_PUZZLE_CONFIG.leaderboardPrizes,
            });
        } else {
            // Daily leaderboard (today's puzzle)
            const puzzleDate = getCurrentPuzzleId();

            let snapshot;
            try {
                snapshot = await db.collection('weeklyPuzzleScores')
                    .where('puzzleDate', '==', puzzleDate)
                    .orderBy('score', 'desc')
                    .orderBy('completedAt', 'asc')
                    .limit(safeLimit)
                    .get();
            } catch (indexError) {
                console.warn('[WEEKLY-LEADERBOARD] Daily index not ready:', indexError.message);
                return res.status(200).json({
                    success: true,
                    type: 'daily',
                    puzzleDate,
                    leaderboard: [],
                    message: 'Leaderboard index is being created. Check back soon!',
                });
            }

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
                success: true,
                type: 'daily',
                puzzleDate,
                leaderboard,
            });
        }
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

        console.log(`[WEEKLY-GENERATE] Request for date: ${dateStr} (daysAhead: ${daysAhead})`);

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

/**
 * Handle curated puzzle data from n8n
 * POST /api/weekly/curated
 * 
 * New format (preferred):
 * [{ wheel: ["b","a","s",...], wheelMap: {b:1, a:2,...}, answers: ["word1",...] }]
 * 
 * Legacy format (still supported):
 * ["word1", "word2", ...] or { curated: [...] }
 */
async function handleCuratedWords(req, res) {
    try {
        // Validate webhook secret
        const webhookSecret = req.headers['x-webhook-secret'] || req.headers['x-client-secret'];
        if (webhookSecret !== process.env.N8N_WEBHOOK_SECRET && webhookSecret !== process.env.APP_CLIENT_SECRET) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        let puzzleData;
        const body = req.body;

        // New format: { wheel: [...], wheelMap: {...}, answers: [...] }
        // Also accepts: [{ wheel: [...], ... }]
        let data = null;

        if (Array.isArray(body) && body.length > 0 && body[0]?.wheel && body[0]?.answers) {
            // Array format: [{ wheel: [...], ... }]
            data = body[0];
        } else if (body?.wheel && body?.answers) {
            // Direct object format: { wheel: [...], ... }
            data = body;
        }

        if (data) {
            // Validate required fields
            if (!Array.isArray(data.wheel) || !Array.isArray(data.answers)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid format: wheel and answers must be arrays'
                });
            }

            // Build words array with points
            // answers can be: ["word1", "word2"] or [{ word: "word1", lang: "English" }, ...]
            const words = data.answers.map(answer => {
                // Handle both string and object formats
                const isObject = typeof answer === 'object' && answer !== null;
                const wordStr = isObject ? answer.word : answer;
                const lang = isObject ? (answer.lang || 'en') : 'en';
                const meaning = isObject ? (answer.meaning || null) : null;

                return {
                    word: latinize(wordStr),
                    lang,
                    meaning, // For future hint/tip feature
                    points: wordStr.length * 10, // 10 points per letter
                };
            });

            puzzleData = {
                letters: data.wheel.map(l => l.toUpperCase()), // Wheel letters
                wheelMap: data.wheelMap || {}, // Letter counts
                words,
                totalPoints: words.reduce((sum, w) => sum + w.points, 0),
            };

            console.log(`[CURATED] New format - wheel: ${data.wheel.length} letters, answers: ${data.answers.length} words`);
        }
        // Legacy format: plain array of words
        else if (Array.isArray(body) && body.length > 0 && typeof body[0] === 'string') {
            const curatedWords = body;
            const sortedWords = curatedWords.map(w => latinize(w)).sort((a, b) => b.length - a.length);

            // Build wheel from all unique letters
            const allLettersSet = new Set();
            sortedWords.forEach(word => {
                word.split('').forEach(letter => allLettersSet.add(letter.toUpperCase()));
            });

            const words = sortedWords.map(word => ({
                word,
                lang: 'en',
                points: word.length * 10,
            }));

            puzzleData = {
                letters: Array.from(allLettersSet),
                words,
                totalPoints: words.reduce((sum, w) => sum + w.points, 0),
            };

            console.log(`[CURATED] Legacy format - ${curatedWords.length} words`);
        }
        // Legacy format: { curated: [...] }
        else if (body?.curated && Array.isArray(body.curated)) {
            const curatedWords = body.curated;
            const sortedWords = curatedWords.map(w => latinize(w)).sort((a, b) => b.length - a.length);

            const allLettersSet = new Set();
            sortedWords.forEach(word => {
                word.split('').forEach(letter => allLettersSet.add(letter.toUpperCase()));
            });

            const words = sortedWords.map(word => ({
                word,
                lang: 'en',
                points: word.length * 10,
            }));

            puzzleData = {
                letters: Array.from(allLettersSet),
                words,
                totalPoints: words.reduce((sum, w) => sum + w.points, 0),
            };

            console.log(`[CURATED] Legacy curated format - ${curatedWords.length} words`);
        }
        else {
            return res.status(400).json({
                success: false,
                error: 'Invalid payload format. Expected: [{ wheel: [...], answers: [...] }] or ["word1", ...]'
            });
        }

        // Validate we have data
        if (!puzzleData.words || puzzleData.words.length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Need at least 3 words/answers'
            });
        }

        // Calculate puzzle date
        const today = new Date();
        const utcYear = today.getUTCFullYear();
        const utcMonth = today.getUTCMonth();
        const utcDate = today.getUTCDate();

        const daysAhead = parseInt(req.query.daysAhead || '0', 10);
        const targetDate = new Date(Date.UTC(utcYear, utcMonth, utcDate + daysAhead));
        const puzzleDate = targetDate.toISOString().split('T')[0];

        console.log(`[CURATED] Puzzle date: ${puzzleDate} (daysAhead: ${daysAhead})`);

        // Generate grid placement for words (add row, col, direction while preserving lang/meaning)
        const gridResult = generateGridFromWords(puzzleData.words, puzzleData.letters);

        // Use the placed words which now have row, col, direction
        console.log(`[CURATED] Placed ${gridResult.words.length}/${puzzleData.words.length} words on grid`);

        const db = admin.firestore();
        const cacheRef = db.collection('weeklyPuzzleCache').doc(puzzleDate);

        // Store in Firestore with grid-placed words
        await cacheRef.set({
            puzzleDate,
            letters: puzzleData.letters,
            wheelMap: puzzleData.wheelMap || null,
            words: gridResult.words, // Use words with row/col/direction from grid generation
            totalPoints: gridResult.words.reduce((sum, w) => sum + w.points, 0),
            generatedAt: FieldValue.serverTimestamp(),
            curatedFromN8N: true,
        });

        console.log(`[CURATED] Saved puzzle for ${puzzleDate} with ${puzzleData.words.length} words`);

        return res.status(200).json({
            success: true,
            message: 'Curated puzzle saved successfully',
            puzzleDate,
            letters: puzzleData.letters.join(''),
            wordCount: puzzleData.words.length,
            words: puzzleData.words.map(w => w.word),
            totalPoints: puzzleData.totalPoints,
        });

    } catch (error) {
        console.error('[CURATED] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Generate a crossword grid from curated words
 * Improved algorithm with proper overlap detection and adjacency checking
 * @param {Array} wordObjects - Array of word objects with { word, lang, meaning, points }
 * @param {Array} letters - Array of available letters
 */
function generateGridFromWords(wordObjects, letters) {
    const GRID_SIZE = 15; // Increased grid size for better placement
    const occupiedCells = {}; // key = "row,col", value = { letter, wordDirection }
    const placedWords = [];

    // Create a map from word string to full word object
    const wordMap = new Map();
    wordObjects.forEach(w => {
        const wordStr = typeof w === 'string' ? w : w.word;
        wordMap.set(wordStr, w);
    });

    // Get word strings and sort by length (longest first for better placement)
    const words = wordObjects
        .map(w => typeof w === 'string' ? w : w.word)
        .sort((a, b) => b.length - a.length);

    /**
     * Check if a cell is occupied
     */
    const getCell = (row, col) => occupiedCells[`${row},${col}`] || null;

    /**
     * Check if placing a word would create invalid adjacencies
     * Words should only touch at valid intersection points, never visually merge
     */
    const checkAdjacency = (word, row, col, direction) => {
        const len = word.length;

        for (let i = 0; i < len; i++) {
            const r = direction === 'H' ? row : row + i;
            const c = direction === 'H' ? col + i : col;
            const letter = word[i];
            const existingCell = getCell(r, c);

            // If cell is occupied and has different letter, invalid
            if (existingCell && existingCell.letter !== letter) {
                return false;
            }

            // If cell is occupied with same letter but same direction, invalid (parallel overlap)
            if (existingCell && existingCell.letter === letter && existingCell.direction === direction) {
                return false;
            }

            // Check parallel adjacency for non-intersection cells
            if (direction === 'H') {
                // Check above and below for non-intersection cells
                if (!existingCell) {
                    const above = getCell(r - 1, c);
                    const below = getCell(r + 1, c);
                    // If there's a horizontal word adjacent, it's invalid
                    if (above && above.direction === 'H') return false;
                    if (below && below.direction === 'H') return false;
                }
            } else {
                // Check left and right for non-intersection cells
                if (!existingCell) {
                    const left = getCell(r, c - 1);
                    const right = getCell(r, c + 1);
                    // If there's a vertical word adjacent, it's invalid
                    if (left && left.direction === 'V') return false;
                    if (right && right.direction === 'V') return false;
                }
            }
        }

        // Check cells immediately before and after the word
        if (direction === 'H') {
            if (getCell(row, col - 1)) return false; // Cell before
            if (getCell(row, col + len)) return false; // Cell after

            // **NEW**: Check corner cells to prevent visual merging
            // If there's a vertical word ending just before this word starts,
            // it will visually appear to merge (like "AVERO" instead of "VERO")
            const cornerTopLeft = getCell(row - 1, col - 1);
            const cornerBottomLeft = getCell(row + 1, col - 1);
            const cornerTopRight = getCell(row - 1, col + len);
            const cornerBottomRight = getCell(row + 1, col + len);

            // Check if a vertical word ends/starts adjacent to our word's start/end
            if (cornerTopLeft && cornerTopLeft.direction === 'V') {
                // Check if there's a cell directly above our start that connects
                const cellAboveStart = getCell(row - 1, col);
                if (!cellAboveStart) return false; // Would create visual merge
            }
            if (cornerBottomLeft && cornerBottomLeft.direction === 'V') {
                const cellBelowStart = getCell(row + 1, col);
                if (!cellBelowStart) return false;
            }
        } else {
            if (getCell(row - 1, col)) return false; // Cell before
            if (getCell(row + len, col)) return false; // Cell after

            // **NEW**: Check corner cells for vertical words
            const cornerTopLeft = getCell(row - 1, col - 1);
            const cornerTopRight = getCell(row - 1, col + 1);
            const cornerBottomLeft = getCell(row + len, col - 1);
            const cornerBottomRight = getCell(row + len, col + 1);

            // Check if a horizontal word ends/starts adjacent to our word's start/end
            if (cornerTopLeft && cornerTopLeft.direction === 'H') {
                const cellLeftOfStart = getCell(row, col - 1);
                if (!cellLeftOfStart) return false;
            }
            if (cornerTopRight && cornerTopRight.direction === 'H') {
                const cellRightOfStart = getCell(row, col + 1);
                if (!cellRightOfStart) return false;
            }
        }

        return true;
    };

    /**
     * Check if word can be placed at position
     */
    const canPlace = (word, row, col, direction) => {
        const len = word.length;

        // Check bounds
        if (row < 0 || col < 0) return false;
        if (direction === 'H' && col + len > GRID_SIZE) return false;
        if (direction === 'V' && row + len > GRID_SIZE) return false;

        // For first word, just check bounds
        if (placedWords.length === 0) return true;

        let hasIntersection = false;

        // Check each cell
        for (let i = 0; i < len; i++) {
            const r = direction === 'H' ? row : row + i;
            const c = direction === 'H' ? col + i : col;
            const letter = word[i];
            const existingCell = getCell(r, c);

            if (existingCell) {
                // Cell is occupied - must be same letter and perpendicular direction
                if (existingCell.letter !== letter) return false;
                if (existingCell.direction === direction) return false; // Parallel overlap
                hasIntersection = true;
            }
        }

        // Must have at least one intersection (except first word)
        if (!hasIntersection) return false;

        // Check adjacency constraints
        if (!checkAdjacency(word, row, col, direction)) return false;

        return true;
    };

    /**
     * Place a word on the grid
     */
    const placeWord = (wordStr, row, col, direction) => {
        for (let i = 0; i < wordStr.length; i++) {
            const r = direction === 'H' ? row : row + i;
            const c = direction === 'H' ? col + i : col;
            const key = `${r},${c}`;

            // Only set if not already occupied (intersection)
            if (!occupiedCells[key]) {
                occupiedCells[key] = { letter: wordStr[i], direction };
            }
        }

        // Get original word object to preserve lang, meaning, points
        const original = wordMap.get(wordStr);
        const isObject = typeof original === 'object' && original !== null;

        placedWords.push({
            word: wordStr,
            lang: isObject ? original.lang : 'en',
            meaning: isObject ? (original.meaning || null) : null,
            row,
            col,
            direction,
            points: isObject ? original.points : Math.max(5, wordStr.length * 10),
        });
    };

    /**
     * Find all possible placements for a word
     */
    const findPlacements = (word) => {
        const placements = [];

        if (placedWords.length === 0) {
            // First word - place horizontally in middle
            const row = Math.floor(GRID_SIZE / 2);
            const col = Math.floor((GRID_SIZE - word.length) / 2);
            return [{ row, col, direction: 'H', score: 100 }];
        }

        // Try to intersect with existing words
        for (const placed of placedWords) {
            for (let i = 0; i < placed.word.length; i++) {
                for (let j = 0; j < word.length; j++) {
                    if (placed.word[i] === word[j]) {
                        // Found matching letter
                        const placedR = placed.direction === 'H' ? placed.row : placed.row + i;
                        const placedC = placed.direction === 'H' ? placed.col + i : placed.col;

                        // Try perpendicular direction only
                        const newDir = placed.direction === 'H' ? 'V' : 'H';
                        const newRow = newDir === 'H' ? placedR : placedR - j;
                        const newCol = newDir === 'H' ? placedC - j : placedC;

                        if (canPlace(word, newRow, newCol, newDir)) {
                            // Score based on how central the placement is
                            const centerDist = Math.abs(newRow - GRID_SIZE / 2) + Math.abs(newCol - GRID_SIZE / 2);
                            placements.push({
                                row: newRow,
                                col: newCol,
                                direction: newDir,
                                score: 100 - centerDist
                            });
                        }
                    }
                }
            }
        }

        // Sort by score (prefer more central placements)
        placements.sort((a, b) => b.score - a.score);
        return placements;
    };

    // Place all words
    for (const word of words) {
        const placements = findPlacements(word);
        if (placements.length > 0) {
            const best = placements[0];
            placeWord(word, best.row, best.col, best.direction);
            console.log(`[GRID] Placed: ${word} at (${best.row},${best.col}) ${best.direction}`);
        } else {
            console.log(`[GRID] Could not place: ${word}`);
        }
    }

    console.log(`[GRID] Placed ${placedWords.length}/${words.length} words`);

    // Calculate actual grid bounds
    let minRow = GRID_SIZE, maxRow = 0, minCol = GRID_SIZE, maxCol = 0;
    Object.keys(occupiedCells).forEach(key => {
        const [r, c] = key.split(',').map(Number);
        minRow = Math.min(minRow, r);
        maxRow = Math.max(maxRow, r);
        minCol = Math.min(minCol, c);
        maxCol = Math.max(maxCol, c);
    });

    // Normalize positions so grid starts at 0,0
    const normalizedWords = placedWords.map(w => ({
        ...w,
        row: w.row - minRow,
        col: w.col - minCol,
    }));

    return {
        letters,
        words: normalizedWords,
    };
}

module.exports = {
    handleWeeklyChallenge,
    handleWeeklySubmitWord,
    handleWeeklyHint,
    handleWeeklyTip,
    handleWeeklyLeaderboard,
    handleGenerateWordPuzzle,
    handleCuratedWords,
};
