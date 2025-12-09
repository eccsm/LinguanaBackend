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
        const { messages, model = 'gpt-3.5-turbo' } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Invalid messages format' });
        }

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: model,
                messages: messages,
                max_tokens: 150,
                temperature: 0.8,
                presence_penalty: 0.3,
                frequency_penalty: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        res.status(200).json(response.data);

    } catch (error) {
        console.error('Chat API Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to generate chat response',
            details: error.message
        });
    }
};