/**
 * Universal Daily Challenge API
 * Handles all daily challenge routes in a single serverless function
 * 
 * FEATURES:
 * - Universal challenge: Same words for everyone (multi-language)
 * - 15 questions from 13+ different languages
 * - Users match words to their native language
 * - 3 lives system with ad-continue option
 * - One completion per day (no re-entry)
 * - Themed word generation via OpenAI
 * - Global leaderboard
 * - Streak tracking with bonuses
 * 
 * Routes:
 *   GET  /daily?action=challenge&nativeLanguage=en&userId=xxx
 *   GET  /daily?action=leaderboard&date=2024-01-01&limit=100
 *   POST /daily?action=submit-score
 *        Body: { userId, displayName, score, maxScore, completionTime, 
 *                correctAnswers, wrongAnswers, usedAdContinue, completed }
 */

const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Supported languages for the universal daily challenge
const ALL_LANGUAGES = [
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
];

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

// Generate universal daily challenge (same for everyone, different languages)
function generateUniversalDailyChallenge(wordPool, userNativeLanguage = 'en') {
  const seed = getTodaySeed();
  const rng = new SeededRandom(seed);
  const theme = getTodayTheme();

  console.log(`[CHALLENGE] Generating for native language: ${userNativeLanguage}`);
  console.log(`[CHALLENGE] Word pool size: ${wordPool.length}`);

  // **CRITICAL FIX**: Filter out words from user's native language
  // Spanish user should NOT get Spanish words to translate
  const filteredWords = wordPool.filter(wordData => {
    const wordLanguage = wordData.language || 'en';
    const isNativeLanguage = wordLanguage === userNativeLanguage;

    if (isNativeLanguage) {
      console.log(`[FILTER] Excluding "${wordData.word}" (${wordLanguage}) - matches native language`);
    }

    return !isNativeLanguage;
  });

  console.log(`[CHALLENGE] After filtering: ${filteredWords.length} words available`);

  // If we don't have enough words after filtering, add some English words as fallback
  if (filteredWords.length < 15 && userNativeLanguage !== 'en') {
    console.log('[CHALLENGE] Not enough words, adding English fallbacks');
    const englishWords = wordPool.filter(w => (w.language || 'en') === 'en');
    filteredWords.push(...englishWords.slice(0, 15 - filteredWords.length));
  }

  // Select 15 words from filtered pool
  const selectedWords = filteredWords.slice(0, 15);
  console.log(`[CHALLENGE] Selected ${selectedWords.length} words for questions`);

  const questions = selectedWords.map((wordData, index) => {
    const wordLanguage = wordData.language || 'en';
    const wordLanguageInfo = ALL_LANGUAGES.find(l => l.code === wordLanguage) || { name: 'English', nativeName: 'English' };
    const targetTranslation = wordData.translations[userNativeLanguage] || wordData.translations.en;

    // Get native language name for display
    const userLanguageInfo = ALL_LANGUAGES.find(l => l.code === userNativeLanguage) || { name: 'English', nativeName: 'English' };

    // All questions are multiple choice translation
    return {
      id: index + 1,
      type: 'multiple_choice',
      question: `What does "${wordData.word}" mean in ${userLanguageInfo.name}?`,
      hint: `This word is from ${wordLanguageInfo.name} (${wordLanguageInfo.nativeName})`,
      word: wordData.word,
      wordLanguage: wordLanguageInfo.name,
      wordLanguageCode: wordLanguage,
      wordLanguageNative: wordLanguageInfo.nativeName,
      correctAnswer: targetTranslation,
      options: generateOptions(wordData, filteredWords, userNativeLanguage, rng, 3),
      difficulty: wordData.difficulty,
      points: wordData.difficulty * 10,
    };
  });

  return {
    date: new Date().toISOString().split('T')[0],
    seed,
    userNativeLanguage,
    theme,
    totalQuestions: questions.length,
    maxScore: questions.reduce((sum, q) => sum + q.points, 0),
    totalLives: 3, // Users get 3 lives
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

// Generate universal multi-language words using OpenAI
async function generateUniversalWordsWithOpenAI(theme) {
  try {
    console.log(`[OPENAI] Generating universal multi-language words - Theme: ${theme}`);

    const languageList = ALL_LANGUAGES.map(l => l.name).join(', ');

    const prompt = `Generate a JSON array of exactly 15 vocabulary words from DIFFERENT languages for a universal daily language challenge.

Theme: ${theme}

Languages to use (mix them): ${languageList}

For each word, provide:
- The word in its original language (choose from: Spanish, French, German, Turkish, Arabic, Hindi, English, Italian, Portuguese, Russian, Japanese, Chinese, Korean)
- The language code (es, fr, de, tr, ar, hi, en, it, pt, ru, ja, zh, ko)
- Translations to ALL these languages
- A difficulty level (1=beginner, 2=intermediate, 3=advanced)

Requirements:
- Use words from at least 10 DIFFERENT languages
- Mix of difficulty levels (8 level-1, 5 level-2, 2 level-3)
- Common, practical vocabulary
- Relevant to the theme
- Appropriate for language learners

Format as a JSON array:
[
  {
    "word": "Hola",
    "language": "es",
    "translations": {
      "en": "Hello",
      "es": "Hola",
      "fr": "Bonjour",
      "de": "Hallo",
      "tr": "Merhaba",
      "ar": "مرحبا",
      "hi": "नमस्ते",
      "it": "Ciao",
      "pt": "Olá",
      "ru": "Привет",
      "ja": "こんにちは",
      "zh": "你好",
      "ko": "안녕하세요"
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
            content: 'You are a multilingual language learning expert. Generate diverse vocabulary lists from multiple languages as valid JSON arrays only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 3000,
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

    if (!Array.isArray(words) || words.length < 15) {
      console.warn(`[OPENAI] Expected 15 words, got ${words.length}`);
    }

    console.log(`[OPENAI] Successfully generated ${words.length} multi-language words`);
    return words;

  } catch (error) {
    console.error('[OPENAI] Error generating words:', error.message);
    throw error;
  }
}

// Get or generate today's universal word pool (same for everyone)
async function getTodayUniversalWordPool() {
  const db = admin.firestore();
  const today = new Date().toISOString().split('T')[0];
  const theme = getTodayTheme();

  try {
    // Check if we already generated universal words for today
    const cacheRef = db.collection('dailyChallengeCache').doc(`universal_${today}`);
    const cacheDoc = await cacheRef.get();

    if (cacheDoc.exists) {
      console.log(`[CACHE] Using cached universal words for ${today}`);
      return cacheDoc.data().words;
    }

    // Generate new universal multi-language words with OpenAI
    console.log(`[CACHE] No cache found, generating new universal words...`);
    const words = await generateUniversalWordsWithOpenAI(theme);

    // Cache the words for the day (same for all users)
    await cacheRef.set({
      date: today,
      theme,
      words,
      generatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[CACHE] Cached universal words for ${today}`);
    return words;

  } catch (error) {
    console.error('[CACHE] Error getting universal word pool:', error.message);

    // Fallback to a mix of static words if OpenAI fails
    console.log('[CACHE] Falling back to mixed static word pool');
    const fallbackWords = [];
    Object.keys(WORD_POOLS).forEach(lang => {
      if (WORD_POOLS[lang].length > 0) {
        fallbackWords.push({ ...WORD_POOLS[lang][0], language: lang });
      }
    });
    return fallbackWords.slice(0, 15);
  }
}

// Handler functions
async function handleChallenge(req, res) {
  try {
    const { nativeLanguage = 'en', userId } = req.query;
    const today = new Date().toISOString().split('T')[0];

    // Check if user has already completed OR has in-progress challenge
    if (userId) {
      const db = admin.firestore();
      const existingScoreQuery = await db.collection('dailyChallengeScores')
        .where('userId', '==', userId)
        .where('date', '==', today)
        .limit(1)
        .get();

      if (!existingScoreQuery.empty) {
        const existingData = existingScoreQuery.docs[0].data();

        // If already completed, block
        if (existingData.completed) {
          return res.status(403).json({
            success: false,
            error: 'Already completed',
            message: 'You have already completed today\'s challenge. Come back tomorrow!',
            alreadyCompleted: true,
            completedAt: existingData.timestamp
          });
        }

        // If in progress, return saved progress
        if (existingData.savedProgress) {
          const progress = existingData.savedProgress;

          // **CRITICAL FIX**: Use answers.length instead of currentQuestion
          // answers.length is the reliable source of truth (avoids React closure issues)
          const answeredQuestions = progress.answers?.length || 0;
          const totalQuestions = progress.challenge?.totalQuestions || 13;

          const isValidProgress =
            progress.lives > 0 &&
            answeredQuestions < totalQuestions;

          if (isValidProgress) {
            console.log(`[RESUME] User has saved progress: ${answeredQuestions}/${totalQuestions} questions, ${progress.lives} lives`);
            return res.status(200).json({
              success: true,
              hasProgress: true,
              savedProgress: existingData.savedProgress,
              message: 'Resume from where you left off!'
            });
          } else {
            console.log(`[RESUME] Invalid progress (lives: ${progress.lives}, answered: ${answeredQuestions}/${totalQuestions}) - treating as completed`);
            // Game was over, treat as completed
            return res.status(403).json({
              success: false,
              error: 'Already completed',
              message: 'You have already attempted today\'s challenge. Come back tomorrow!',
              alreadyCompleted: true,
              completedAt: existingData.timestamp
            });
          }
        }
      }
    }

    // Get today's universal word pool (same for everyone)
    const wordPool = await getTodayUniversalWordPool();

    // Generate universal challenge using the word pool
    const challenge = generateUniversalDailyChallenge(wordPool, nativeLanguage);

    res.status(200).json({ success: true, challenge });
  } catch (error) {
    console.error('[DAILY-CHALLENGE] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate challenge', details: error.message });
  }
}

async function handleLeaderboard(req, res) {
  try {
    const { date, limit = 100 } = req.query;
    const db = admin.firestore();
    const today = date || new Date().toISOString().split('T')[0];

    const scoresRef = db.collection('dailyChallengeScores');
    // **GLOBAL LEADERBOARD**: Show ALL attempts (completed AND failed)
    // This allows partial scores to be visible (e.g., 80/180 pts)
    const query = scoresRef
      .where('date', '==', today)
      .orderBy('score', 'desc')
      .orderBy('completionTime', 'asc')
      .limit(parseInt(limit));

    console.log(`[LEADERBOARD] Fetching global leaderboard for ${today}...`);

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
        correctAnswers: data.correctAnswers,
        wrongAnswers: data.wrongAnswers,
        usedAdContinue: data.usedAdContinue || false,
        completed: data.completed || false, // Show if they finished all questions
        timestamp: data.timestamp,
      });
      rank++;
    });

    console.log(`[LEADERBOARD] Found ${leaderboard.length} entries`);

    const stats = {
      totalParticipants: leaderboard.length,
      averageScore: leaderboard.length > 0
        ? Math.round(leaderboard.reduce((sum, entry) => sum + entry.score, 0) / leaderboard.length)
        : 0,
      highestScore: leaderboard[0]?.score || 0,
    };

    res.status(200).json({ success: true, date: today, leaderboard, stats });
  } catch (error) {
    console.error('[DAILY-LEADERBOARD] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch leaderboard', details: error.message });
  }
}

async function handleSubmitScore(req, res) {
  try {
    const {
      userId,
      displayName,
      score,
      maxScore,
      completionTime,
      correctAnswers,
      wrongAnswers,
      usedAdContinue = false, // Whether user watched ad to continue after 3 mistakes
      completed = false, // Whether user finished all questions
      savedProgress = null // Progress data for resuming (if not completed)
    } = req.body;

    if (!userId || score === undefined || !maxScore) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const db = admin.firestore();
    const today = new Date().toISOString().split('T')[0];

    // Check if user already completed today's challenge
    const existingScoreQuery = await db.collection('dailyChallengeScores')
      .where('userId', '==', userId)
      .where('date', '==', today)
      .limit(1)
      .get();

    if (!existingScoreQuery.empty) {
      const existingDoc = existingScoreQuery.docs[0];
      const existingData = existingDoc.data();

      // If user already completed, don't allow resubmission
      if (existingData.completed) {
        return res.status(403).json({
          success: false,
          error: 'Already completed today',
          message: 'You have already completed today\'s challenge. Come back tomorrow!',
          existingScore: existingData.score,
        });
      }

      // Update existing incomplete submission
      const updateData = {
        score,
        completionTime,
        correctAnswers,
        wrongAnswers,
        usedAdContinue,
        completed,
        timestamp: FieldValue.serverTimestamp(),
      };

      // Save progress if not completed
      if (!completed && savedProgress) {
        updateData.savedProgress = savedProgress;
        console.log(`[SAVE-PROGRESS] Saving progress for ${userId}`);
      } else if (completed) {
        // Remove saved progress when completed
        updateData.savedProgress = admin.firestore.FieldValue.delete();
      }

      await existingDoc.ref.update(updateData);
    } else {
      // Create new submission
      const newSubmission = {
        userId,
        displayName: displayName || 'Anonymous',
        date: today,
        score,
        maxScore,
        completionTime,
        correctAnswers,
        wrongAnswers,
        usedAdContinue,
        completed,
        timestamp: FieldValue.serverTimestamp(),
      };

      // Add savedProgress if not completed
      if (!completed && savedProgress) {
        newSubmission.savedProgress = savedProgress;
        console.log(`[SAVE-PROGRESS] Creating new entry with progress for ${userId}`);
      }

      await db.collection('dailyChallengeScores').add(newSubmission);
    }

    // Only update streak if user completed the challenge
    if (completed) {
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
          } else if (lastPlayedDate !== today) {
            // Streak broken, reset to 1
            newStreak = 1;
          } else {
            // Same day, keep current streak
            newStreak = currentStreak;
          }
        }

        const newLongestStreak = Math.max(newStreak, longestStreak);
        const isFirstCompletion = !existingScoreQuery.empty ? !existingScoreQuery.docs[0].data().completed : true;

        await userRef.update({
          lastDailyChallengeDate: today,
          dailyChallengeStreak: newStreak,
          longestDailyChallengeStreak: newLongestStreak,
          totalDailyChallengesCompleted: FieldValue.increment(isFirstCompletion ? 1 : 0),
        });

        let streakBonus = null;
        if (newStreak >= 7) {
          streakBonus = { type: 'weekly_streak', reward: '🔥 7-day streak!', bonus: 100 };
        } else if (newStreak >= 3) {
          streakBonus = { type: '3_day_streak', reward: '⭐ 3-day streak!', bonus: 50 };
        }

        return res.status(200).json({
          success: true,
          message: completed ? 'Challenge completed!' : 'Progress saved',
          score: { current: score, max: maxScore, percentage: Math.round((score / maxScore) * 100) },
          streak: { current: newStreak, longest: newLongestStreak, bonus: streakBonus },
          completed,
        });
      }
    }

    // If not completed or user doesn't exist, just return score
    res.status(200).json({
      success: true,
      message: completed ? 'Challenge completed!' : 'Progress saved',
      score: { current: score, max: maxScore, percentage: Math.round((score / maxScore) * 100) },
      completed,
    });
  } catch (error) {
    console.error('[SUBMIT-SCORE] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit score', details: error.message });
  }
}

// Award gems to yesterday's winner
async function handleAwardWinner(req, res) {
  try {
    const { date } = req.query;
    const db = admin.firestore();

    // Get yesterday's date if not specified
    const targetDate = date || (() => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().split('T')[0];
    })();

    console.log(`[AWARD-WINNER] Checking for winner on ${targetDate}...`);

    // Get top scorer for that date
    const scoresRef = db.collection('dailyChallengeScores');
    const query = scoresRef
      .where('date', '==', targetDate)
      .orderBy('score', 'desc')
      .orderBy('completionTime', 'asc')
      .limit(1);

    const snapshot = await query.get();

    if (snapshot.empty) {
      console.log(`[AWARD-WINNER] No participants found for ${targetDate}`);
      return res.status(404).json({
        success: false,
        message: `No participants found for ${targetDate}`
      });
    }

    const winnerDoc = snapshot.docs[0];
    const winnerData = winnerDoc.data();
    const winnerId = winnerData.userId;

    console.log(`[AWARD-WINNER] Winner: ${winnerData.displayName} (${winnerId}) with ${winnerData.score} pts`);

    // Check if already awarded
    if (winnerData.gemAwarded) {
      console.log(`[AWARD-WINNER] Gems already awarded for ${targetDate}`);
      return res.status(200).json({
        success: true,
        message: 'Gems already awarded',
        winner: {
          userId: winnerId,
          displayName: winnerData.displayName,
          score: winnerData.score,
          alreadyAwarded: true
        }
      });
    }

    // Award 100 gems to winner
    const userRef = db.collection('users').doc(winnerId);
    await userRef.update({
      gems: FieldValue.increment(100)
    });

    // Mark as awarded
    await winnerDoc.ref.update({
      gemAwarded: true,
      gemAwardedAt: FieldValue.serverTimestamp()
    });

    console.log(`[AWARD-WINNER] ✅ Awarded 100 gems to ${winnerData.displayName}`);

    return res.status(200).json({
      success: true,
      message: 'Winner awarded 100 gems!',
      winner: {
        userId: winnerId,
        displayName: winnerData.displayName,
        score: winnerData.score,
        gemsAwarded: 100
      }
    });

  } catch (error) {
    console.error('[AWARD-WINNER] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to award winner',
      details: error.message
    });
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
    case 'award-winner':
      return handleAwardWinner(req, res);
    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use: ?action=challenge, ?action=leaderboard, ?action=submit-score, or ?action=award-winner'
      });
  }
};
