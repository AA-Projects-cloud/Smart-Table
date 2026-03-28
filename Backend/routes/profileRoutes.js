const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

// Profile routes
router.get('/:email', profileController.getProfile);
router.post('/save', profileController.saveProfile);
router.post('/mcq/add', profileController.addMcqResult);

module.exports = router;
