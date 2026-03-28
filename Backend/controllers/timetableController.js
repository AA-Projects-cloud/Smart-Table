const supabase = require('../config/db');

const getTimetable = async (req, res, next) => {
    try {
        const { semester, role } = req.params;
        const userId = req.user.id || req.user.sub;
        
        // Find timetable for this user or for the general semester
        // For simplicity, we'll store per semester/section for students, and per user/semester for faculty
        const query = supabase
            .from('timetable_sessions')
            .select('*')
            .eq('semester', semester);
            
        if (role === 'faculty') {
            query.eq('faculty_id', userId);
        } else {
            // Assume section is 'Section A' for now
            query.eq('section', 'Section A');
        }

        const { data: sessions, error } = await query;

        if (error) throw error;

        if (sessions && sessions.length > 0) {
            // Transform flat sessions back to the grid for the frontend
            // (Assuming 5 slots and 5 days)
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const times = ['09:00 - 10:00', '10:00 - 11:00', '11:15 - 12:15', '12:15 - 01:15', '02:00 - 03:00'];
            
            const grid = times.map(time => ({
                time,
                days: days.map(() => ({ subject: '', type: 'empty' }))
            }));

            sessions.forEach(s => {
                const dayIndex = days.indexOf(s.day);
                const timeIndex = times.indexOf(s.slot);
                if (dayIndex !== -1 && timeIndex !== -1) {
                    grid[timeIndex].days[dayIndex] = {
                        subject: s.subject,
                        faculty: s.faculty,
                        room: s.room,
                        type: 'filled',
                        code: s.subject_code
                    };
                }
            });

            res.json({ success: true, data: grid });
        } else {
            res.json({ success: true, data: [] });
        }
    } catch (error) {
        next(error);
    }
};

const saveTimetable = async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { semester, section, sessions } = req.body;
        const role = req.user.publicMetadata?.role || 'faculty';

        // Flatten the grid sessions
        const flatSessions = [];
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        
        sessions.forEach((row, rowIndex) => {
            row.days.forEach((cell, cellIndex) => {
                if (cell.type !== 'empty') {
                    flatSessions.push({
                        semester,
                        section: section || 'Section A',
                        day: days[cellIndex],
                        slot: row.time,
                        subject: cell.subject,
                        subject_code: cell.code || '',
                        faculty: cell.faculty || '',
                        faculty_id: role === 'faculty' ? userId : (cell.faculty_id || null),
                        room: cell.room || ''
                    });
                }
            });
        });

        // 1. Clear existing sessions for this context
        const deleteQuery = supabase
            .from('timetable_sessions')
            .delete()
            .eq('semester', semester);
            
        if (role === 'faculty') {
            deleteQuery.eq('faculty_id', userId);
        } else {
            deleteQuery.eq('section', section || 'Section A');
        }

        const { error: delErr } = await deleteQuery;
        if (delErr) throw delErr;

        // 2. Insert new sessions
        if (flatSessions.length > 0) {
            const { error: iErr } = await supabase
                .from('timetable_sessions')
                .insert(flatSessions);
            if (iErr) throw iErr;
        }

        res.json({ success: true, message: 'Timetable saved' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTimetable,
    saveTimetable
};
