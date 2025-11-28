// backend/services/vocabularyExtraction.js
const { initializeFirebase } = require('../utils/firebaseInit');
const admin = initializeFirebase();
const db = admin.firestore();

/**
 * Extract vocabulary from conversation and add to user's vocab deck
 * 
 * @param {string} userId - Firebase user ID
 * @param {string} conversationId - Conversation ID
 * @param {Array} messages - Array of conversation messages
 * @param {string} targetLanguage - Target language code (e.g., 'es', 'fr')
 * @param {string} nativeLanguage - Native language code (e.g., 'en')
 * @returns {Object} - { wordsAdded, totalWords }
 */
const extractVocabularyFromConversation = async (
  userId,
  conversationId,
  messages,
  targetLanguage = 'es',
  nativeLanguage = 'en'
) => {
  try {
    console.log(`📚 Extracting vocabulary for user ${userId} from conversation ${conversationId}`);
    
    // Extract target language messages (AI responses)
    const targetMessages = messages
      .filter(msg => msg.role === 'assistant')
      .map(msg => msg.content)
      .join(' ');

    // Simple keyword extraction (in production, use OpenAI or NLP)
    // For now, extract common words/phrases
    const vocabulary = extractKeyPhrases(targetMessages, targetLanguage);
    
    // Get translations for each word/phrase
    const vocabWithTranslations = await getTranslations(vocabulary, targetLanguage, nativeLanguage);
    
    // Add to user's vocab deck
    let wordsAdded = 0;
    const batch = db.batch();
    
    for (const item of vocabWithTranslations) {
      // Check if word already exists
      const existing = await db
        .collection('users')
        .doc(userId)
        .collection('vocabDeck')
        .where('front', '==', item.front)
        .limit(1)
        .get();
      
      if (existing.empty) {
        // Add new word
        const newCardRef = db
          .collection('users')
          .doc(userId)
          .collection('vocabDeck')
          .doc();
        
        batch.set(newCardRef, {
          front: item.front,
          back: item.back,
          context: item.context,
          interval: 1,
          repetitions: 0,
          easeFactor: 2.5,
          nextReview: admin.firestore.Timestamp.fromDate(new Date()),
          lastReviewed: null,
          totalReviews: 0,
          source: 'conversation',
          conversationId: conversationId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        wordsAdded++;
      }
    }
    
    if (wordsAdded > 0) {
      await batch.commit();
      console.log(`✅ Added ${wordsAdded} new words to vocab deck`);
    } else {
      console.log(`ℹ️ No new words to add (all already exist)`);
    }
    
    return {
      success: true,
      wordsAdded,
      totalWords: vocabWithTranslations.length
    };
    
  } catch (error) {
    console.error('❌ Error extracting vocabulary:', error.message);
    throw error;
  }
};

/**
 * Extract key phrases from text (simplified version)
 * In production, use OpenAI or proper NLP library
 */
const extractKeyPhrases = (text, targetLanguage) => {
  // Simple extraction based on common words
  // This is a placeholder - in production, use OpenAI API
  
  const commonSpanishWords = {
    'hola': { translation: 'hello', context: 'Hola, ¿cómo estás?' },
    'gracias': { translation: 'thank you', context: 'Gracias por tu ayuda.' },
    'adiós': { translation: 'goodbye', context: 'Adiós, hasta luego.' },
    'por favor': { translation: 'please', context: '¿Puedes ayudarme, por favor?' },
    'buenos días': { translation: 'good morning', context: 'Buenos días, ¿cómo estás?' },
    'buenas tardes': { translation: 'good afternoon', context: 'Buenas tardes.' },
    'buenas noches': { translation: 'good night', context: 'Buenas noches, que duermas bien.' },
    'perdón': { translation: 'sorry/excuse me', context: 'Perdón, no entendí.' },
    'sí': { translation: 'yes', context: 'Sí, estoy de acuerdo.' },
    'no': { translation: 'no', context: 'No, no quiero.' }
  };
  
  const found = [];
  const lowerText = text.toLowerCase();
  
  // Check for each common word/phrase
  for (const [phrase, data] of Object.entries(commonSpanishWords)) {
    if (lowerText.includes(phrase) && !found.includes(phrase)) {
      found.push(phrase);
    }
  }
  
  return found.slice(0, 5); // Limit to 5 words per conversation
};

/**
 * Get translations for words/phrases
 * In production, use OpenAI translation API
 */
const getTranslations = async (words, targetLanguage, nativeLanguage) => {
  // Simple translation mapping (placeholder)
  const translations = {
    'hola': { back: 'hello', context: 'Hola, ¿cómo estás?' },
    'gracias': { back: 'thank you', context: 'Gracias por tu ayuda.' },
    'adiós': { back: 'goodbye', context: 'Adiós, hasta luego.' },
    'por favor': { back: 'please', context: '¿Puedes ayudarme, por favor?' },
    'buenos días': { back: 'good morning', context: 'Buenos días, ¿cómo estás?' },
    'buenas tardes': { back: 'good afternoon', context: 'Buenas tardes.' },
    'buenas noches': { back: 'good night', context: 'Buenas noches.' },
    'perdón': { back: 'sorry', context: 'Perdón, no entendí.' },
    'sí': { back: 'yes', context: 'Sí, estoy de acuerdo.' },
    'no': { back: 'no', context: 'No, no quiero.' }
  };
  
  return words.map(word => ({
    front: word,
    back: translations[word]?.back || 'translation',
    context: translations[word]?.context || `Example: ${word}`
  }));
};

module.exports = {
  extractVocabularyFromConversation
};
