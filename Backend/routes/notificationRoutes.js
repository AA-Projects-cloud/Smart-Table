const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

// Send notification (HOD/Faculty)
router.post('/send', notificationController.sendGlobalNotification);

// Get notifications
router.get('/', notificationController.getNotifications);

module.exports = router;
