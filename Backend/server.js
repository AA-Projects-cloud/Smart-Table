require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const timetableRoutes = require('./routes/timetableRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const aiRoutes = require('./routes/aiRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const profileRoutes = require('./routes/profileRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const errorHandler = require('./middleware/error');

const app = express();

// Supabase client is initialized in config/db.js but no direct connection call is needed

// Global Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Routes
app.get('/', (req, res) => res.json({ status: 'SmartTable backend is running' }));
app.use('/api/timetable', timetableRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/attendance', attendanceRoutes);

// Global Error Handler
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend listening on port ${port}`));
