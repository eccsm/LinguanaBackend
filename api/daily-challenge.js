/**
 * Daily Challenge API
 * Generates a deterministic daily challenge that's the same for all users
 * Uses date-based seed for consistency
 */

const { getFirestore } = require('firebase-admin/firestore');

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

// Game types
const GAME_TYPES = [
  'translation', // Match word to translation
  'reverse_translation', // Match translation to word
  'fill_blank', // Fill in missing letters
  'multiple_choice', // Choose correct translation from 4 options
  'listening', // Match audio to text (future enhancement)
];

// Seeded random number generator for consistency
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

// Get today's date seed (same for all users on the same day)
function getTodaySeed() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  return year * 10000 + month * 100 + day; // e.g., 20251130
}

// Generate daily challenge
function generateDailyChallenge(language = 'es', userNativeLanguage = 'en') {
  const seed = getTodaySeed();
  const rng = new SeededRandom(seed);

  const wordPool = WORD_POOLS[language] || WORD_POOLS.es;
  
  // Select 10 words for the daily challenge
  const selectedWords = rng.shuffle(wordPool).slice(0, 10);

  // Generate 10 questions with varying difficulty
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
          points: wordData.difficulty * 15, // Harder, more points
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
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    seed,
    language,
    userNativeLanguage,
    totalQuestions: questions.length,
    maxScore: questions.reduce((sum, q) => sum + q.points, 0),
    questions,
  };
}

// Helper: Generate wrong answer options for translation
function generateOptions(wordData, wordPool, targetLang, rng, count = 3) {
  const correct = wordData.translations[targetLang] || wordData.translations.en;
  const wrongOptions = wordPool
    .filter(w => w.word !== wordData.word)
    .map(w => w.translations[targetLang] || w.translations.en)
    .filter(t => t !== correct);
  
  const selected = rng.shuffle(wrongOptions).slice(0, count);
  return rng.shuffle([correct, ...selected]);
}

// Helper: Generate wrong answer options for reverse translation
function generateReverseOptions(wordData, wordPool, rng, count = 3) {
  const correct = wordData.word;
  const wrongOptions = wordPool
    .filter(w => w.word !== correct)
    .map(w => w.word);
  
  const selected = rng.shuffle(wrongOptions).slice(0, count);
  return rng.shuffle([correct, ...selected]);
}

// Helper: Create blanked word for fill-in-the-blank
function createBlankWord(word, rng) {
  const index = Math.floor(rng.next() * word.length);
  const correctLetter = word[index];
  const blankedWord = word.substring(0, index) + '_' + word.substring(index + 1);
  return { blankedWord, correctLetter };
}

// Helper: Generate letter options
function generateLetterOptions(correctLetter, rng) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const wrongLetters = alphabet
    .split('')
    .filter(l => l !== correctLetter.toLowerCase());
  
  const selected = rng.shuffle(wrongLetters).slice(0, 3);
  return rng.shuffle([correctLetter, ...selected]);
}

// API Handler
module.exports = async (req, res) => {
  try {
    const { language = 'es', nativeLanguage = 'en' } = req.query;

    console.log(`[DAILY-CHALLENGE] Generating for language: ${language}, native: ${nativeLanguage}`);

    const challenge = generateDailyChallenge(language, nativeLanguage);

    res.status(200).json({
      success: true,
      challenge,
    });

  } catch (error) {
    console.error('[DAILY-CHALLENGE] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate daily challenge',
      details: error.message,
    });
  }
};
