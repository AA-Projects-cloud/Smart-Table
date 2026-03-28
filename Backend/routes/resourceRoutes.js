const express = require('express');
const { upload, uploadFile, downloadFile, getResourcesBySubject, getAllResources } = require('../controllers/resourceController');
const { verifyClerkSession } = require('../middleware/auth');

const router = express.Router();

router.post('/upload', verifyClerkSession, upload.single('resource'), uploadFile);
router.get('/all', verifyClerkSession, getAllResources);
router.get('/:subjectCode', verifyClerkSession, getResourcesBySubject);
router.get('/download/:name', verifyClerkSession, downloadFile);

module.exports = router;
