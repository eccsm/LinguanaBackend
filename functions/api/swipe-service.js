/**
 * Speed Swipe Game Service
 * 
 * Handles word management for the Speed Swipe game.
 * Daily rotation: n8n pushes 100 random word pairs, clears old data first.
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Helper to verify n8n webhook secret
function verifyWebhookSecret(req) {
    const secret = req.headers['x-webhook-secret'];
    const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!expectedSecret) {
        console.error('[SWIPE] N8N_WEBHOOK_SECRET not configured');
        return false;
    }

    return secret === expectedSecret;
}

// Language code mapping
const LANGUAGE_CODES = {
    'English': 'en',
    'Spanish': 'es',
    'Italian': 'it',
    'French': 'fr',
    'Portuguese': 'pt',
    'German': 'de',
    'Turkish': 'tr'
};

/**
 * POST /api/swipe/refresh
 * 
 * Called by n8n daily to refresh swipe words.
 * Clears existing words and inserts new batch.
 * 
 * Expected body format (from n8n transforming Google Sheets):
 * {
 *   "words": [
 *     { "English": "hello", "Spanish": "hola", "Italian": "ciao", ... },
 *     { "English": "cat", "Spanish": "gato", "Italian": "gatto", ... }
 *   ]
 * }
 */
async function handleRefreshWords(req, res) {
    console.log('[SWIPE] Refresh words endpoint called');

    // Verify webhook secret for n8n
    if (!verifyWebhookSecret(req)) {
        console.log('[SWIPE] Webhook secret verification failed');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { words } = req.body;

        if (!words || !Array.isArray(words) || words.length === 0) {
            return res.status(400).json({ error: 'Invalid payload: words array required' });
        }

        console.log(`[SWIPE] Received ${words.length} words to process`);

        const db = admin.firestore();
        const collection = db.collection('dailySwipeWords');

        // Step 1: Delete all existing documents
        console.log('[SWIPE] Clearing existing words...');
        const existingDocs = await collection.get();
        const deletePromises = existingDocs.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);
        console.log(`[SWIPE] Deleted ${existingDocs.size} existing documents`);

        // Step 2: Transform and insert new words
        // For each row, create pairs for each language combination (English as source)
        const pairs = [];
        const sourceLanguage = 'en'; // English is always the source

        for (const row of words) {
            const englishWord = row.English;
            if (!englishWord || englishWord === 'Loading...') continue;

            // Create a pair for each target language
            for (const [langName, langCode] of Object.entries(LANGUAGE_CODES)) {
                if (langCode === 'en') continue; // Skip English as target

                const translation = row[langName];
                if (!translation || translation === 'Loading...') continue;

                pairs.push({
                    word: englishWord.trim(),
                    translation: translation.trim(),
                    sourceLanguage: sourceLanguage,
                    targetLanguage: langCode,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        console.log(`[SWIPE] Created ${pairs.length} word pairs`);

        // Batch write (max 500 per batch)
        const batches = [];
        let currentBatch = db.batch();
        let operationCount = 0;

        for (const pair of pairs) {
            const docRef = collection.doc();
            currentBatch.set(docRef, pair);
            operationCount++;

            if (operationCount >= 500) {
                batches.push(currentBatch);
                currentBatch = db.batch();
                operationCount = 0;
            }
        }

        if (operationCount > 0) {
            batches.push(currentBatch);
        }

        // Execute all batches
        await Promise.all(batches.map(batch => batch.commit()));
        console.log(`[SWIPE] Inserted ${pairs.length} word pairs in ${batches.length} batches`);

        return res.status(200).json({
            success: true,
            message: `Refreshed ${pairs.length} word pairs`,
            deletedCount: existingDocs.size,
            insertedCount: pairs.length
        });

    } catch (error) {
        console.error('[SWIPE] Error refreshing words:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

/**
 * GET /api/swipe/words
 * 
 * Fetches random word pairs for the game.
 * Query params:
 *   - targetLanguage: Language code (es, tr, de, etc.) - required
 *   - count: Number of pairs to fetch (default 50)
 * 
 * Returns cards with isCorrect flag (60% correct, 40% wrong translations)
 */
async function handleGetWords(req, res) {
    console.log('[SWIPE] Get words endpoint called');

    try {
        const targetLanguage = req.query.targetLanguage || 'es';
        const count = Math.min(parseInt(req.query.count) || 50, 100);
        const sourceLanguage = 'en';

        console.log(`[SWIPE] Fetching ${count} pairs for ${sourceLanguage} -> ${targetLanguage}`);

        const db = admin.firestore();

        // Fetch words for the target language
        const snapshot = await db.collection('dailySwipeWords')
            .where('sourceLanguage', '==', sourceLanguage)
            .where('targetLanguage', '==', targetLanguage)
            .get();

        if (snapshot.empty) {
            console.log('[SWIPE] No words found, returning fallback');
            return res.status(200).json({
                cards: getFallbackCards(),
                source: 'fallback'
            });
        }

        // Convert to array and shuffle
        const allWords = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        const shuffled = shuffleArray(allWords);
        const selected = shuffled.slice(0, Math.min(count, shuffled.length));

        // Generate game cards with correct/wrong flag
        const cards = generateGameCards(selected, allWords);

        console.log(`[SWIPE] Returning ${cards.length} cards`);

        return res.status(200).json({
            cards,
            source: 'firestore',
            totalAvailable: allWords.length
        });

    } catch (error) {
        console.error('[SWIPE] Error fetching words:', error);
        return res.status(200).json({
            cards: getFallbackCards(),
            source: 'fallback',
            error: error.message
        });
    }
}

/**
 * Generate game cards with random correct/incorrect pairs
 */
function generateGameCards(selectedWords, allWords) {
    const cards = [];

    for (let i = 0; i < selectedWords.length; i++) {
        const word = selectedWords[i];
        const showCorrect = Math.random() > 0.4; // 60% correct, 40% wrong

        if (showCorrect) {
            cards.push({
                id: i,
                word: word.word,
                translation: word.translation,
                isCorrect: true
            });
        } else {
            // Get a random WRONG translation from a different word
            const wrongWord = getRandomDifferentWord(allWords, word);
            cards.push({
                id: i,
                word: word.word,
                translation: wrongWord.translation,
                isCorrect: false
            });
        }
    }

    return cards;
}

/**
 * Get a random word that's different from the given word
 */
function getRandomDifferentWord(words, excludeWord) {
    const filtered = words.filter(w => w.word !== excludeWord.word);
    if (filtered.length === 0) return excludeWord;
    return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Fallback cards when no data in Firestore
 */
function getFallbackCards() {
    const fallbackWords = [
        { word: 'Hello', translation: 'Hola', isCorrect: true },
        { word: 'Cat', translation: 'Perro', isCorrect: false },
        { word: 'Water', translation: 'Agua', isCorrect: true },
        { word: 'House', translation: 'Coche', isCorrect: false },
        { word: 'Friend', translation: 'Amigo', isCorrect: true },
        { word: 'Book', translation: 'Libro', isCorrect: true },
        { word: 'Sun', translation: 'Luna', isCorrect: false },
        { word: 'Milk', translation: 'Leche', isCorrect: true },
        { word: 'Dog', translation: 'Gato', isCorrect: false },
        { word: 'Red', translation: 'Rojo', isCorrect: true }
    ];

    // Generate 50 cards by cycling through fallback
    const cards = [];
    for (let i = 0; i < 50; i++) {
        const base = fallbackWords[i % fallbackWords.length];
        cards.push({ ...base, id: i });
    }
    return cards;
}

/**
 * GET /api/swipe/stats
 * 
 * Returns stats about available words (for monitoring)
 */
async function handleGetStats(req, res) {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('dailySwipeWords').get();

        // Count by language
        const langCounts = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const key = `${data.sourceLanguage}->${data.targetLanguage}`;
            langCounts[key] = (langCounts[key] || 0) + 1;
        });

        return res.status(200).json({
            totalWords: snapshot.size,
            byLanguagePair: langCounts,
            lastUpdated: new Date().toISOString()
        });

    } catch (error) {
        console.error('[SWIPE] Error getting stats:', error);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = {
    handleRefreshWords,
    handleGetWords,
    handleGetStats
};
