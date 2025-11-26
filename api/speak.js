const axios = require('axios');

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

        const response = await axios.post(
            'https://api.openai.com/v1/audio/speech',
            {
                model: "tts-1",
                voice: voice,
                input: text,
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        const audioBase64 = Buffer.from(response.data, 'binary').toString('base64');

        res.status(200).json({ audio: audioBase64 });

    } catch (error) {
        res.status(500).json({
            error: 'Failed to generate speech',
            details: error.message
        });
    }
};