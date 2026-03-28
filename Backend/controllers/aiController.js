const { GoogleGenerativeAI } = require('@google/generative-ai');

const generateAIResponse = async (req, res, next) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is missing' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 512,
                temperature: 0.8
            }
        });

        const responseText = result.response.text();

        res.json({ result: responseText });
    } catch (error) {
        console.error('Gemini API Error:', error.message || error);
        next(error);
    }
};

module.exports = {
    generateAIResponse
};
