/**
 * STT Endpoint (Speech-to-Text using OpenAI Whisper)
 * Serverless function for Vercel
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { parseMultipartForm } = require('../utils/parseMultipart');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let audioFilePath = null;

    try {
        // Parse multipart form data
        const { fields, files } = await parseMultipartForm(req);

        const language = fields.language || 'en';
        const audioFile = files.audio;

        if (!audioFile) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        console.log('📝 Transcription request:', {
            filename: audioFile.filename,
            language: language
        });

        // Read the file from /tmp directory
        audioFilePath = audioFile.filepath;

        const formData = new FormData();
        formData.append('file', fs.createReadStream(audioFilePath), {
            filename: audioFile.filename || 'audio.mp4',
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
        if (audioFilePath && fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }

        console.log('✅ Transcription successful:', response.data.text);
        res.status(200).json({
            text: response.data.text,
            language: response.data.language
        });

    } catch (error) {
        console.error('❌ Transcription error:', error.message);

        // Clean up on error
        if (audioFilePath && fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
        }

        res.status(500).json({
            error: 'Failed to transcribe audio',
            details: error.message
        });
    }
};
