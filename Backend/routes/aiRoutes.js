const express = require('express');
const { generateAIResponse } = require('../controllers/aiController');
const { verifyClerkSession } = require('../middleware/auth');

const router = express.Router();

router.post('/gemini', verifyClerkSession, generateAIResponse);

module.exports = router;
