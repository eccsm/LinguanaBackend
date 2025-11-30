/**
 * Consolidated Daily Challenge API
 * Handles all daily challenge routes in a single serverless function
 * Uses OpenAI to generate fresh, themed word lists daily
 * Routes:
 *   GET  /daily?action=challenge&language=es&nativeLanguage=en
 *   GET  /daily?action=leaderboard&language=es&limit=100
 *   POST /daily?action=submit-score
 */

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Daily themes that rotate based on day of year
const THEMES = [
  'Travel & Transportation',
  'Food & Dining',
  'Shopping & Money',
  'Health & Body',
  'Family & Relationships',
  'Work & Business',
  'Education & Learning',
  'Home & Living',
  'Weather & Nature',
  'Sports & Hobbies',
  'Technology & Communication',
  'Emotions & Feelings',
  'Time & Schedules',
  'Clothing & Fashion',
  'Entertainment & Culture',
];

function getTodayTheme() {
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
  return THEMES[dayOfYear % THEMES.length];
}

// Word pools for different languages
const WORD_POOLS = {
  es: [ // Spanish
    { word: 'Hola', translations: { en: 'Hello', tr: 'Merhaba', de: 'Hallo', fr: 'Bonjour', ar: 'مرحبا' }, difficulty: 1 },
    { word: 'Gracias', translations: { en: 'Thank you', tr: 'Teşekkür ederim', de: 'Danke', fr: 'Merci', ar: 'شكرا' }, difficulty: 1 },
    { word: 'Adiós', translations: { en: 'Goodbye', tr: 'Hoşça kal', de: 'Auf Wiedersehen', fr: 'Au revoir', ar: 'وداعا' }, difficulty: 1 },
    { word: 'Por favor', translations: { en: 'Please', tr: 'Lütfen', de: 'Bitte', fr: 'S\'il vous plaît', ar: 'من فضلك' }, difficulty: 1 },
    { word: 'Lo siento', translations: { en: 'Sorry', tr: 'Üzgünüm', de: 'Entschuldigung', fr: 'Désolé', ar: 'آسف' }, difficulty: 1 },
    { word: 'Agua', translations: { en: 'Water', tr: 'Su', de: 'Wasser', fr: 'Eau', ar: 'ماء' }, difficulty: 1 },
    { word: 'Comida', translations: { en: 'Food', tr: 'Yemek', de: 'Essen', fr: 'Nourriture', ar: 'طعام' }, difficulty: 2 },
    { word: 'Casa', translations: { en: 'House', tr: 'Ev', de: 'Haus', fr: 'Maison', ar: 'منزل' }, difficulty: 1 },
    { word: 'Familia', translations: { en: 'Family', tr: 'Aile', de: 'Familie', fr: 'Famille', ar: 'عائلة' }, difficulty: 1 },
    { word: 'Tiempo', translations: { en: 'Time', tr: 'Zaman', de: 'Zeit', fr: 'Temps', ar: 'وقت' }, difficulty: 2 },
    { word: 'Dinero', translations: { en: 'Money', tr: 'Para', de: 'Geld', fr: 'Argent', ar: 'مال' }, difficulty: 2 },
    { word: 'Trabajo', translations: { en: 'Work', tr: 'İş', de: 'Arbeit', fr: 'Travail', ar: 'عمل' }, difficulty: 2 },
    { word: 'Escuela', translations: { en: 'School', tr: 'Okul', de: 'Schule', fr: 'École', ar: 'مدرسة' }, difficulty: 2 },
    { word: 'Coche', translations: { en: 'Car', tr: 'Araba', de: 'Auto', fr: 'Voiture', ar: 'سيارة' }, difficulty: 2 },
    { word: 'Restaurante', translations: { en: 'Restaurant', tr: 'Restoran', de: 'Restaurant', fr: 'Restaurant', ar: 'مطعم' }, difficulty: 2 },
    { word: 'Aeropuerto', translations: { en: 'Airport', tr: 'Havaalanı', de: 'Flughafen', fr: 'Aéroport', ar: 'مطار' }, difficulty: 3 },
    { word: 'Biblioteca', translations: { en: 'Library', tr: 'Kütüphane', de: 'Bibliothek', fr: 'Bibliothèque', ar: 'مكتبة' }, difficulty: 3 },
    { word: 'Universidad', translations: { en: 'University', tr: 'Üniversite', de: 'Universität', fr: 'Université', ar: 'جامعة' }, difficulty: 3 },
    { word: 'Supermercado', translations: { en: 'Supermarket', tr: 'Süpermarket', de: 'Supermarkt', fr: 'Supermarché', ar: 'سوبر ماركت' }, difficulty: 3 },
    { word: 'Farmacia', translations: { en: 'Pharmacy', tr: 'Eczane', de: 'Apotheke', fr: 'Pharmacie', ar: 'صيدلية' }, difficulty: 3 },
  ],
  fr: [ // French
    { word: 'Bonjour', translations: { en: 'Hello', tr: 'Merhaba', de: 'Hallo', es: 'Hola', ar: 'مرحبا' }, difficulty: 1 },
    { word: 'Merci', translations: { en: 'Thank you', tr: 'Teşekkür ederim', de: 'Danke', es: 'Gracias', ar: 'شكرا' }, difficulty: 1 },
    { word: 'Au revoir', translations: { en: 'Goodbye', tr: 'Hoşça kal', de: 'Auf Wiedersehen', es: 'Adiós', ar: 'وداعا' }, difficulty: 1 },
    { word: 'S\'il vous plaît', translations: { en: 'Please', tr: 'Lütfen', de: 'Bitte', es: 'Por favor', ar: 'من فضلك' }, difficulty: 2 },
    { word: 'Désolé', translations: { en: 'Sorry', tr: 'Üzgünüm', de: 'Entschuldigung', es: 'Lo siento', ar: 'آسف' }, difficulty: 1 },
    { word: 'Pain', translations: { en: 'Bread', tr: 'Ekmek', de: 'Brot', es: 'Pan', ar: 'خبز' }, difficulty: 1 },
    { word: 'Eau', translations: { en: 'Water', tr: 'Su', de: 'Wasser', es: 'Agua', ar: 'ماء' }, difficulty: 1 },
    { word: 'Maison', translations: { en: 'House', tr: 'Ev', de: 'Haus', es: 'Casa', ar: 'منزل' }, difficulty: 1 },
    { word: 'Chat', translations: { en: 'Cat', tr: 'Kedi', de: 'Katze', es: 'Gato', ar: 'قطة' }, difficulty: 1 },
    { word: 'Chien', translations: { en: 'Dog', tr: 'Köpek', de: 'Hund', es: 'Perro', ar: 'كلب' }, difficulty: 1 },
    { word: 'Voiture', translations: { en: 'Car', tr: 'Araba', de: 'Auto', es: 'Coche', ar: 'سيارة' }, difficulty: 2 },
    { word: 'Restaurant', translations: { en: 'Restaurant', tr: 'Restoran', de: 'Restaurant', es: 'Restaurante', ar: 'مطعم' }, difficulty: 2 },
    { word: 'Aéroport', translations: { en: 'Airport', tr: 'Havaalanı', de: 'Flughafen', es: 'Aeropuerto', ar: 'مطار' }, difficulty: 3 },
    { word: 'Bibliothèque', translations: { en: 'Library', tr: 'Kütüphane', de: 'Bibliothek', es: 'Biblioteca', ar: 'مكتبة' }, difficulty: 3 },
    { word: 'Université', translations: { en: 'University', tr: 'Üniversite', de: 'Universität', es: 'Universidad', ar: 'جامعة' }, difficulty: 3 },
  ],
  de: [ // German
    { word: 'Hallo', translations: { en: 'Hello', tr: 'Merhaba', es: 'Hola', fr: 'Bonjour', ar: 'مرحبا' }, difficulty: 1 },
    { word: 'Danke', translations: { en: 'Thank you', tr: 'Teşekkür ederim', es: 'Gracias', fr: 'Merci', ar: 'شكرا' }, difficulty: 1 },
    { word: 'Auf Wiedersehen', translations: { en: 'Goodbye', tr: 'Hoşça kal', es: 'Adiós', fr: 'Au revoir', ar: 'وداعا' }, difficulty: 2 },
    { word: 'Bitte', translations: { en: 'Please', tr: 'Lütfen', es: 'Por favor', fr: 'S\'il vous plaît', ar: 'من فضلك' }, difficulty: 1 },
    { word: 'Entschuldigung', translations: { en: 'Sorry', tr: 'Üzgünüm', es: 'Lo siento', fr: 'Désolé', ar: 'آسف' }, difficulty: 2 },
    { word: 'Wasser', translations: { en: 'Water', tr: 'Su', es: 'Agua', fr: 'Eau', ar: 'ماء' }, difficulty: 1 },
    { word: 'Brot', translations: { en: 'Bread', tr: 'Ekmek', es: 'Pan', fr: 'Pain', ar: 'خبز' }, difficulty: 1 },
    { word: 'Haus', translations: { en: 'House', tr: 'Ev', es: 'Casa', fr: 'Maison', ar: 'منزل' }, difficulty: 1 },
    { word: 'Katze', translations: { en: 'Cat', tr: 'Kedi', es: 'Gato', fr: 'Chat', ar: 'قطة' }, difficulty: 1 },
    { word: 'Hund', translations: { en: 'Dog', tr: 'Köpek', es: 'Perro', fr: 'Chien', ar: 'كلب' }, difficulty: 1 },
    { word: 'Auto', translations: { en: 'Car', tr: 'Araba', es: 'Coche', fr: 'Voiture', ar: 'سيارة' }, difficulty: 2 },
    { word: 'Restaurant', translations: { en: 'Restaurant', tr: 'Restoran', es: 'Restaurante', fr: 'Restaurant', ar: 'مطعم' }, difficulty: 2 },
    { word: 'Flughafen', translations: { en: 'Airport', tr: 'Havaalanı', es: 'Aeropuerto', fr: 'Aéroport', ar: 'مطار' }, difficulty: 3 },
    { word: 'Bibliothek', translations: { en: 'Library', tr: 'Kütüphane', es: 'Biblioteca', fr: 'Bibliothèque', ar: 'مكتبة' }, difficulty: 3 },
    { word: 'Universität', translations: { en: 'University', tr: 'Üniversite', es: 'Universidad', fr: 'Université', ar: 'جامعة' }, difficulty: 3 },
  ],
  tr: [ // Turkish
    { word: 'Merhaba', translations: { en: 'Hello', de: 'Hallo', es: 'Hola', fr: 'Bonjour', ar: 'مرحبا' }, difficulty: 1 },
    { word: 'Teşekkür ederim', translations: { en: 'Thank you', de: 'Danke', es: 'Gracias', fr: 'Merci', ar: 'شكرا' }, difficulty: 2 },
    { word: 'Güle güle', translations: { en: 'Goodbye', de: 'Auf Wiedersehen', es: 'Adiós', fr: 'Au revoir', ar: 'وداعا' }, difficulty: 2 },
    { word: 'Lütfen', translations: { en: 'Please', de: 'Bitte', es: 'Por favor', fr: 'S\'il vous plaît', ar: 'من فضلك' }, difficulty: 1 },
    { word: 'Özür dilerim', translations: { en: 'Sorry', de: 'Entschuldigung', es: 'Lo siento', fr: 'Désolé', ar: 'آسف' }, difficulty: 2 },
    { word: 'Su', translations: { en: 'Water', de: 'Wasser', es: 'Agua', fr: 'Eau', ar: 'ماء' }, difficulty: 1 },
    { word: 'Ekmek', translations: { en: 'Bread', de: 'Brot', es: 'Pan', fr: 'Pain', ar: 'خبز' }, difficulty: 1 },
    { word: 'Ev', translations: { en: 'House', de: 'Haus', es: 'Casa', fr: 'Maison', ar: 'منزل' }, difficulty: 1 },
    { word: 'Kedi', translations: { en: 'Cat', de: 'Katze', es: 'Gato', fr: 'Chat', ar: 'قطة' }, difficulty: 1 },
    { word: 'Köpek', translations: { en: 'Dog', de: 'Hund', es: 'Perro', fr: 'Chien', ar: 'كلب' }, difficulty: 1 },
    { word: 'Araba', translations: { en: 'Car', de: 'Auto', es: 'Coche', fr: 'Voiture', ar: 'سيارة' }, difficulty: 1 },
    { word: 'Restoran', translations: { en: 'Restaurant', de: 'Restaurant', es: 'Restaurante', fr: 'Restaurant', ar: 'مطعم' }, difficulty: 2 },
    { word: 'Havaalanı', translations: { en: 'Airport', de: 'Flughafen', es: 'Aeropuerto', fr: 'Aéroport', ar: 'مطار' }, difficulty: 2 },
    { word: 'Kütüphane', translations: { en: 'Library', de: 'Bibliothek', es: 'Biblioteca', fr: 'Bibliothèque', ar: 'مكتبة' }, difficulty: 3 },
    { word: 'Üniversite', translations: { en: 'University', de: 'Universität', es: 'Universidad', fr: 'Université', ar: 'جامعة' }, difficulty: 2 },
  ],
  ar: [ // Arabic
    { word: 'مرحبا', translations: { en: 'Hello', de: 'Hallo', es: 'Hola', fr: 'Bonjour', tr: 'Merhaba' }, difficulty: 1 },
    { word: 'شكرا', translations: { en: 'Thank you', de: 'Danke', es: 'Gracias', fr: 'Merci', tr: 'Teşekkür ederim' }, difficulty: 1 },
    { word: 'وداعا', translations: { en: 'Goodbye', de: 'Auf Wiedersehen', es: 'Adiós', fr: 'Au revoir', tr: 'Güle güle' }, difficulty: 1 },
    { word: 'من فضلك', translations: { en: 'Please', de: 'Bitte', es: 'Por favor', fr: 'S\'il vous plaît', tr: 'Lütfen' }, difficulty: 2 },
    { word: 'آسف', translations: { en: 'Sorry', de: 'Entschuldigung', es: 'Lo siento', fr: 'Désolé', tr: 'Özür dilerim' }, difficulty: 1 },
    { word: 'ماء', translations: { en: 'Water', de: 'Wasser', es: 'Agua', fr: 'Eau', tr: 'Su' }, difficulty: 1 },
    { word: 'خبز', translations: { en: 'Bread', de: 'Brot', es: 'Pan', fr: 'Pain', tr: 'Ekmek' }, difficulty: 1 },
    { word: 'منزل', translations: { en: 'House', de: 'Haus', es: 'Casa', fr: 'Maison', tr: 'Ev' }, difficulty: 1 },
    { word: 'قطة', translations: { en: 'Cat', de: 'Katze', es: 'Gato', fr: 'Chat', tr: 'Kedi' }, difficulty: 1 },
    { word: 'كلب', translations: { en: 'Dog', de: 'Hund', es: 'Perro', fr: 'Chien', tr: 'Köpek' }, difficulty: 1 },
    { word: 'سيارة', translations: { en: 'Car', de: 'Auto', es: 'Coche', fr: 'Voiture', tr: 'Araba' }, difficulty: 1 },
    { word: 'مطعم', translations: { en: 'Restaurant', de: 'Restaurant', es: 'Restaurante', fr: 'Restaurant', tr: 'Restoran' }, difficulty: 2 },
    { word: 'مطار', translations: { en: 'Airport', de: 'Flughafen', es: 'Aeropuerto', fr: 'Aéroport', tr: 'Havaalanı' }, difficulty: 2 },
    { word: 'مكتبة', translations: { en: 'Library', de: 'Bibliothek', es: 'Biblioteca', fr: 'Bibliothèque', tr: 'Kütüphane' }, difficulty: 3 },
    { word: 'جامعة', translations: { en: 'University', de: 'Universität', es: 'Universidad', fr: 'Université', tr: 'Üniversite' }, difficulty: 2 },
  ],
};

const GAME_TYPES = ['translation', 'reverse_translation', 'fill_blank', 'multiple_choice', 'listening'];

// Seeded random number generator
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  choice(array) {
    return array[Math.floor(this.next() * array.length)];
  }
}

function getTodaySeed() {
  const today = new Date();
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

function generateDailyChallengeFromPool(wordPool, language = 'es', userNativeLanguage = 'en') {
  const seed = getTodaySeed();
  const rng = new SeededRandom(seed);
  const theme = getTodayTheme();
  
  // Use all 10 words from the pool (already selected by OpenAI)
  const selectedWords = wordPool.slice(0, 10);

  const questions = selectedWords.map((wordData, index) => {
    const gameType = GAME_TYPES[index % GAME_TYPES.length];
    const targetTranslation = wordData.translations[userNativeLanguage] || wordData.translations.en;

    switch (gameType) {
      case 'translation':
        return {
          id: index + 1,
          type: 'translation',
          question: `Translate to ${userNativeLanguage.toUpperCase()}`,
          word: wordData.word,
          correctAnswer: targetTranslation,
          options: generateOptions(wordData, wordPool, userNativeLanguage, rng),
          difficulty: wordData.difficulty,
          points: wordData.difficulty * 10,
        };
      case 'reverse_translation':
        return {
          id: index + 1,
          type: 'reverse_translation',
          question: `What is "${targetTranslation}" in ${language.toUpperCase()}?`,
          word: targetTranslation,
          correctAnswer: wordData.word,
          options: generateReverseOptions(wordData, wordPool, rng),
          difficulty: wordData.difficulty,
          points: wordData.difficulty * 10,
        };
      case 'fill_blank':
        const { blankedWord, correctLetter } = createBlankWord(wordData.word, rng);
        return {
          id: index + 1,
          type: 'fill_blank',
          question: `Complete the word`,
          word: blankedWord,
          hint: targetTranslation,
          correctAnswer: correctLetter,
          options: generateLetterOptions(correctLetter, rng),
          difficulty: wordData.difficulty,
          points: wordData.difficulty * 15,
        };
      case 'multiple_choice':
      default:
        return {
          id: index + 1,
          type: 'multiple_choice',
          question: `What does "${wordData.word}" mean?`,
          word: wordData.word,
          correctAnswer: targetTranslation,
          options: generateOptions(wordData, wordPool, userNativeLanguage, rng, 4),
          difficulty: wordData.difficulty,
          points: wordData.difficulty * 10,
        };
    }
  });

  return {
    date: new Date().toISOString().split('T')[0],
    seed,
    language,
    userNativeLanguage,
    theme,
    totalQuestions: questions.length,
    maxScore: questions.reduce((sum, q) => sum + q.points, 0),
    questions,
  };
}

function generateOptions(wordData, wordPool, targetLang, rng, count = 3) {
  const correct = wordData.translations[targetLang] || wordData.translations.en;
  const wrongOptions = wordPool
    .filter(w => w.word !== wordData.word)
    .map(w => w.translations[targetLang] || w.translations.en)
    .filter(t => t !== correct);
  const selected = rng.shuffle(wrongOptions).slice(0, count);
  return rng.shuffle([correct, ...selected]);
}

function generateReverseOptions(wordData, wordPool, rng, count = 3) {
  const correct = wordData.word;
  const wrongOptions = wordPool.filter(w => w.word !== correct).map(w => w.word);
  const selected = rng.shuffle(wrongOptions).slice(0, count);
  return rng.shuffle([correct, ...selected]);
}

function createBlankWord(word, rng) {
  const index = Math.floor(rng.next() * word.length);
  const correctLetter = word[index];
  const blankedWord = word.substring(0, index) + '_' + word.substring(index + 1);
  return { blankedWord, correctLetter };
}

function generateLetterOptions(correctLetter, rng) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const wrongLetters = alphabet.split('').filter(l => l !== correctLetter.toLowerCase());
  const selected = rng.shuffle(wrongLetters).slice(0, 3);
  return rng.shuffle([correctLetter, ...selected]);
}

// Generate words using OpenAI
async function generateWordsWithOpenAI(language, theme) {
  try {
    console.log(`[OPENAI] Generating words for ${language} - Theme: ${theme}`);

    const languageNames = {
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      tr: 'Turkish',
      ar: 'Arabic',
    };

    const prompt = `Generate a JSON array of exactly 10 vocabulary words for learning ${languageNames[language] || 'Spanish'}.

Theme: ${theme}

For each word, provide:
- The word in ${languageNames[language] || 'Spanish'}
- Translations to: English, Turkish, German, French, Arabic
- A difficulty level (1=beginner, 2=intermediate, 3=advanced)

Requirements:
- Mix of difficulty levels (5 level-1, 3 level-2, 2 level-3)
- Common, practical vocabulary
- Relevant to the theme
- Appropriate for language learners

Format as a JSON array:
[
  {
    "word": "palabra",
    "translations": {
      "en": "word",
      "tr": "kelime",
      "de": "Wort",
      "fr": "mot",
      "ar": "كلمة"
    },
    "difficulty": 1
  },
  ...
]

Return ONLY the JSON array, no explanation.`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a language learning expert. Generate vocabulary lists as valid JSON arrays only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = response.data.choices[0].message.content.trim();
    
    // Extract JSON from response (remove markdown code blocks if present)
    const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from OpenAI response');
    }

    const words = JSON.parse(jsonMatch[0]);
    
    if (!Array.isArray(words) || words.length !== 10) {
      throw new Error(`Invalid word count: expected 10, got ${words.length}`);
    }

    console.log(`[OPENAI] Successfully generated ${words.length} words`);
    return words;

  } catch (error) {
    console.error('[OPENAI] Error generating words:', error.message);
    throw error;
  }
}

// Get or generate today's word pool
async function getTodayWordPool(language) {
  const db = getFirestore();
  const today = new Date().toISOString().split('T')[0];
  const theme = getTodayTheme();

  try {
    // Check if we already generated words for today
    const cacheRef = db.collection('dailyChallengeCache').doc(`${today}_${language}`);
    const cacheDoc = await cacheRef.get();

    if (cacheDoc.exists) {
      console.log(`[CACHE] Using cached words for ${today} - ${language}`);
      return cacheDoc.data().words;
    }

    // Generate new words with OpenAI
    console.log(`[CACHE] No cache found, generating new words...`);
    const words = await generateWordsWithOpenAI(language, theme);

    // Cache the words for the day
    await cacheRef.set({
      date: today,
      language,
      theme,
      words,
      generatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[CACHE] Cached words for ${today} - ${language}`);
    return words;

  } catch (error) {
    console.error('[CACHE] Error getting word pool:', error.message);
    
    // Fallback to static words if OpenAI fails
    console.log('[CACHE] Falling back to static word pool');
    return WORD_POOLS[language] || WORD_POOLS.es;
  }
}

// Handler functions
async function handleChallenge(req, res) {
  try {
    const { language = 'es', nativeLanguage = 'en' } = req.query;
    
    // Get today's word pool (from cache or generate new)
    const wordPool = await getTodayWordPool(language);
    
    // Generate challenge using the word pool
    const challenge = generateDailyChallengeFromPool(wordPool, language, nativeLanguage);
    
    res.status(200).json({ success: true, challenge });
  } catch (error) {
    console.error('[DAILY-CHALLENGE] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate challenge', details: error.message });
  }
}

async function handleLeaderboard(req, res) {
  try {
    const { date, language = 'es', limit = 100 } = req.query;
    const db = getFirestore();
    const today = date || new Date().toISOString().split('T')[0];

    const scoresRef = db.collection('dailyChallengeScores');
    const query = scoresRef
      .where('date', '==', today)
      .where('language', '==', language)
      .orderBy('score', 'desc')
      .orderBy('completionTime', 'asc')
      .limit(parseInt(limit));

    const snapshot = await query.get();
    const leaderboard = [];
    let rank = 1;

    snapshot.forEach(doc => {
      const data = doc.data();
      leaderboard.push({
        rank,
        userId: data.userId,
        displayName: data.displayName || 'Anonymous',
        score: data.score,
        maxScore: data.maxScore,
        percentage: Math.round((data.score / data.maxScore) * 100),
        completionTime: data.completionTime,
        lives: data.lives || 3,
        streak: data.streak || 1,
        timestamp: data.timestamp,
      });
      rank++;
    });

    const stats = {
      totalParticipants: leaderboard.length,
      averageScore: leaderboard.length > 0 
        ? Math.round(leaderboard.reduce((sum, entry) => sum + entry.score, 0) / leaderboard.length)
        : 0,
      highestScore: leaderboard[0]?.score || 0,
    };

    res.status(200).json({ success: true, date: today, language, leaderboard, stats });
  } catch (error) {
    console.error('[DAILY-LEADERBOARD] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard', details: error.message });
  }
}

async function handleSubmitScore(req, res) {
  try {
    const { userId, displayName, date, language, score, maxScore, completionTime, lives, correctAnswers, wrongAnswers } = req.body;

    if (!userId || score === undefined || !maxScore) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const db = getFirestore();
    const today = date || new Date().toISOString().split('T')[0];

    const existingScoreQuery = await db.collection('dailyChallengeScores')
      .where('userId', '==', userId)
      .where('date', '==', today)
      .where('language', '==', language)
      .get();

    let isNewSubmission = existingScoreQuery.empty;

    if (!isNewSubmission) {
      const existingDoc = existingScoreQuery.docs[0];
      const existingData = existingDoc.data();
      if (score > existingData.score) {
        await existingDoc.ref.update({
          score,
          completionTime,
          lives,
          correctAnswers,
          wrongAnswers,
          timestamp: FieldValue.serverTimestamp(),
        });
      } else {
        return res.status(200).json({
          success: true,
          message: 'Score submitted but not improved',
          currentScore: existingData.score,
          newScore: score,
        });
      }
    } else {
      await db.collection('dailyChallengeScores').add({
        userId,
        displayName: displayName || 'Anonymous',
        date: today,
        language,
        score,
        maxScore,
        completionTime,
        lives,
        correctAnswers,
        wrongAnswers,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const userData = userDoc.data();
      const lastPlayedDate = userData.lastDailyChallengeDate;
      const currentStreak = userData.dailyChallengeStreak || 0;
      const longestStreak = userData.longestDailyChallengeStreak || 0;

      let newStreak = 1;
      if (lastPlayedDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (lastPlayedDate === yesterdayStr) {
          newStreak = currentStreak + 1;
        } else if (lastPlayedDate === today) {
          newStreak = currentStreak;
        }
      }

      const newLongestStreak = Math.max(newStreak, longestStreak);

      await userRef.update({
        lastDailyChallengeDate: today,
        dailyChallengeStreak: newStreak,
        longestDailyChallengeStreak: newLongestStreak,
        totalDailyChallengesCompleted: FieldValue.increment(isNewSubmission ? 1 : 0),
      });

      let streakBonus = null;
      if (newStreak >= 7) {
        streakBonus = { type: 'weekly_streak', reward: '🔥 7-day streak!' };
      } else if (newStreak >= 3) {
        streakBonus = { type: '3_day_streak', reward: '⭐ 3-day streak!' };
      }

      res.status(200).json({
        success: true,
        message: 'Score submitted successfully',
        score: { current: score, max: maxScore, percentage: Math.round((score / maxScore) * 100) },
        streak: { current: newStreak, longest: newLongestStreak, bonus: streakBonus },
      });
    } else {
      res.status(200).json({
        success: true,
        message: 'Score submitted successfully',
        score: { current: score, max: maxScore, percentage: Math.round((score / maxScore) * 100) },
      });
    }
  } catch (error) {
    console.error('[SUBMIT-SCORE] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit score', details: error.message });
  }
}

// Main router
module.exports = async (req, res) => {
  const { action } = req.query;

  switch (action) {
    case 'challenge':
      return handleChallenge(req, res);
    case 'leaderboard':
      return handleLeaderboard(req, res);
    case 'submit-score':
      if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
      }
      return handleSubmitScore(req, res);
    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use: ?action=challenge, ?action=leaderboard, or ?action=submit-score'
      });
  }
};
