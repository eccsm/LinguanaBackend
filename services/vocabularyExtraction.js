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
    console.log('[VOCAB_EXTRACT] 📚 Starting extraction:', {
      userId,
      conversationId,
      totalMessages: messages.length,
      targetLanguage,
      nativeLanguage
    });
    
    // Extract target language messages (AI responses)
    const targetMessages = messages
      .filter(msg => msg.role === 'assistant')
      .map(msg => msg.content)
      .join(' ');

    console.log('[VOCAB_EXTRACT] 📤 AI messages extracted:', {
      messageCount: messages.filter(msg => msg.role === 'assistant').length,
      textLength: targetMessages.length,
      preview: targetMessages.substring(0, 100) + '...'
    });

    // Extract vocabulary using OpenAI (production-ready)
    const vocabulary = await extractKeyPhrases(targetMessages, targetLanguage);
    console.log('[VOCAB_EXTRACT] 🔍 Keywords found:', vocabulary);
    
    // Get translations for each word/phrase
    const vocabWithTranslations = await getTranslations(vocabulary, targetLanguage, nativeLanguage);
    console.log('[VOCAB_EXTRACT] 🌍 Translations prepared:', vocabWithTranslations.length, 'words');
    
    // Add to user's vocab deck
    let wordsAdded = 0;
    const batch = db.batch();
    console.log('[VOCAB_EXTRACT] 🔍 Checking for existing cards...');
    
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
        console.log('[VOCAB_EXTRACT] ➕ Adding new word:', item.front, '=', item.back);
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
      } else {
        console.log('[VOCAB_EXTRACT] ⏭️ Skipping existing word:', item.front);
      }
    }
    
    if (wordsAdded > 0) {
      console.log('[VOCAB_EXTRACT] 💾 Committing batch:', wordsAdded, 'new cards');
      await batch.commit();
      console.log(`[VOCAB_EXTRACT] ✅ Successfully added ${wordsAdded} new words to vocab deck`);
    } else {
      console.log(`[VOCAB_EXTRACT] ℹ️ No new words to add (all already exist)`);
    }
    
    console.log('[VOCAB_EXTRACT] 🎉 Extraction complete:', {
      wordsAdded,
      totalWordsFound: vocabWithTranslations.length,
      conversationId
    });
    
    return {
      success: true,
      wordsAdded,
      totalWords: vocabWithTranslations.length
    };
    
  } catch (error) {
    console.error('[VOCAB_EXTRACT] ❌ Error extracting vocabulary:', {
      error: error.message,
      stack: error.stack,
      userId,
      conversationId
    });
    throw error;
  }
};

/**
 * Extract key phrases from text using OpenAI (Production)
 * Uses GPT to intelligently extract relevant vocabulary
 */
const extractKeyPhrases = async (text, targetLanguage) => {
  try {
    const axios = require('axios');
    
    const languageNames = {
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese'
    };
    
    const langName = languageNames[targetLanguage] || targetLanguage;
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a language learning assistant. Extract 5-10 key vocabulary words or phrases from the following ${langName} text that would be useful for a language learner. Focus on commonly used words, useful phrases, and important expressions. Return ONLY a JSON array of strings, nothing else. Example: ["hola", "buenos días", "gracias"]`
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const content = response.data.choices[0].message.content.trim();
    const vocabulary = JSON.parse(content);
    
    console.log(`🔍 Extracted ${vocabulary.length} vocabulary items using OpenAI`);
    return vocabulary;
    
  } catch (error) {
    console.error('❌ OpenAI extraction error:', error.message);
    // Fallback to simple extraction if OpenAI fails
    console.log('⚠️ Falling back to simple extraction');
    return extractKeyPhrasesFallback(text);
  }
};

/**
 * Fallback extraction method (used if OpenAI fails)
 */
const extractKeyPhrasesFallback = (text) => {
  // Simple word splitting as fallback
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const uniqueWords = [...new Set(words)];
  return uniqueWords.slice(0, 5);
};

/**
 * Get translations and example sentences using OpenAI (Production)
 * Creates flashcard data with translations and contextual examples
 */
const getTranslations = async (words, targetLanguage, nativeLanguage) => {
  try {
    const axios = require('axios');
    
    const languageNames = {
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'en': 'English'
    };
    
    const targetLangName = languageNames[targetLanguage] || targetLanguage;
    const nativeLangName = languageNames[nativeLanguage] || nativeLanguage;
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a language learning assistant. For each ${targetLangName} word or phrase provided, create a flashcard with:
1. The original word/phrase (front)
2. The ${nativeLangName} translation (back)
3. An example sentence in ${targetLangName} using that word (context)

Return ONLY a JSON array of objects with this exact format:
[
  {
    "front": "original word",
    "back": "translation",
    "context": "Example sentence in ${targetLangName}"
  }
]

Do not include any other text or explanation.`
          },
          {
            role: 'user',
            content: JSON.stringify(words)
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const content = response.data.choices[0].message.content.trim();
    const translations = JSON.parse(content);
    
    console.log(`🌐 Translated ${translations.length} vocabulary items using OpenAI`);
    return translations;
    
  } catch (error) {
    console.error('❌ OpenAI translation error:', error.message);
    // Fallback to simple translation
    console.log('⚠️ Falling back to simple translation');
    return words.map(word => ({
      front: word,
      back: `Translation of ${word}`,
      context: `Example: ${word} in a sentence.`
    }));
  }
};

module.exports = {
  extractVocabularyFromConversation
};
