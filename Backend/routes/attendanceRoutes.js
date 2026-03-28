const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

router.get('/students/:subjectCode', attendanceController.getStudents);
router.post('/mark', attendanceController.markAttendance);
router.get('/progress/:email', attendanceController.getProgress);

module.exports = router;
