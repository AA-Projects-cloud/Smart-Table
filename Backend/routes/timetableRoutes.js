const express = require('express');
const { getTimetable, saveTimetable } = require('../controllers/timetableController');
const { verifyClerkSession } = require('../middleware/auth');

const router = express.Router();

router.get('/:semester/:role', verifyClerkSession, getTimetable);
router.post('/save', verifyClerkSession, saveTimetable);

module.exports = router;
