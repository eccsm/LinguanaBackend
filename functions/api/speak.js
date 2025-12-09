const axios = require('axios');

// Voice Mapping: OpenAI names -> ElevenLabs Voice IDs
const VOICE_MAPPING = {
    'alloy': '21m00Tcm4TlvDq8ikWAM', // Rachel (American, Clear) - Default
    'echo': 'JBFqnCBsd6RMkjVDRZzb',  // George (British, Warm)
    'fable': 'FGY2WhTYpPnrIDTdsKH5', // Laura (American, Upbeat)
    'onyx': 'IKne3meq5aSn9XLyUdCD',  // Charlie (Australian, Casual)
    'nova': 'XB0fDUnXU5powFXDhCwa',  // Charlotte (British, Seductive/Calm)
    'shimmer': 'EXAVITQu4vr4xnSDxMaL' // Bella (American, Soft)
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-client-secret');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const clientSecret = req.headers['x-client-secret'];
    if (clientSecret !== process.env.APP_CLIENT_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { text, voice = 'alloy' } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'No text provided' });
        }

        const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenLabsApiKey) {
            throw new Error('ELEVENLABS_API_KEY is not configured on server');
        }

        // Map OpenAI voice name to ElevenLabs ID, default to Rachel if not found
        const voiceId = VOICE_MAPPING[voice] || VOICE_MAPPING['alloy'];

        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text: text,
                model_id: "eleven_monolingual_v1", // or "eleven_multilingual_v2" for better non-English
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            },
            {
                headers: {
                    'xi-api-key': elevenLabsApiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg'
                },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        const audioBase64 = Buffer.from(response.data, 'binary').toString('base64');

        res.status(200).json({ audio: audioBase64 });

    } catch (error) {
        console.error('ElevenLabs Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to generate speech',
            details: error.message
        });
    }
};