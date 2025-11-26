/**
 * TTS Endpoint (Text-to-Speech using OpenAI TTS)
 * Serverless function for Vercel
 */

const axios = require('axios');

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

    try {
        const { text, voice = 'alloy' } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'No text provided' });
        }

        console.log('🗣️ Generating speech for:', text.substring(0, 30) + '...');

        const response = await axios.post(
            'https://api.openai.com/v1/audio/speech',
            {
                model: "tts-1",
                voice: voice, // Options: alloy, echo, fable, onyx, nova, shimmer
                input: text,
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer', // Important: Receive binary data
                timeout: 30000
            }
        );

        // Convert binary audio to base64 to send safely to React Native
        const audioBase64 = Buffer.from(response.data, 'binary').toString('base64');

        console.log('✅ Speech generated successfully');
        res.status(200).json({ audio: audioBase64 });

    } catch (error) {
        console.error('❌ TTS Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to generate speech',
            details: error.message
        });
    }
};
