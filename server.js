/**
 * Simple STT & TTS Backend Service
 * Handles audio transcription (STT) and speech generation (TTS)
 */

const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Load .env from parent directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Increase limit for audio files if necessary
app.use(express.json({ limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Linguana Backend Service' });
});

// ==========================================
// 1. STT Endpoint (Hearing - Whisper)
// ==========================================
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const { language = 'en' } = req.body;
    const audioFile = req.file;

    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('📝 Transcription request:', {
      filename: audioFile.originalname,
      language: language
    });

    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioFile.path), {
      filename: audioFile.originalname || 'audio.mp4',
      contentType: audioFile.mimetype || 'audio/mp4'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        },
        timeout: 30000
      }
    );

    // Clean up
    fs.unlinkSync(audioFile.path);

    console.log('✅ Transcription successful:', response.data.text);
    res.json({ text: response.data.text, language: response.data.language });

  } catch (error) {
    console.error('❌ Transcription error:', error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

// ==========================================
// 2. TTS Endpoint (Speaking - OpenAI TTS)
// ==========================================
app.post('/speak', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    console.log('🗣️ Generating speech for:', text.substring(0, 30) + '...');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      {
        model: "tts-1",
        voice: "alloy", // Options: alloy, echo, fable, onyx, nova, shimmer
        input: text,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer' // Important: Receive binary data
      }
    );

    // Convert binary audio to base64 to send safely to React Native
    const audioBase64 = Buffer.from(response.data, 'binary').toString('base64');
    
    console.log('✅ Speech generated successfully');
    res.json({ audio: audioBase64 });

  } catch (error) {
    console.error('❌ TTS Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`
🎙️ Linguana Backend Service running!
📡 Port: ${PORT}
🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Configured ✅' : 'Missing ❌'}
  `);
});