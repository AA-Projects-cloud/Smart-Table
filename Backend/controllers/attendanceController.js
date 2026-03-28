const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const attendanceFile = path.join(dataDir, 'attendance.json');

// Initialize if not exists
if (!fs.existsSync(attendanceFile)) {
    fs.writeFileSync(attendanceFile, JSON.stringify([]));
}

const getStudents = async (req, res, next) => {
    try {
        const { year } = req.query;
        let query = supabase
            .from('user_profiles')
            .select('email, full_name, year')
            .eq('role', 'student');

        if (year) {
            query = query.eq('year', parseInt(year, 10));
        }

        const { data, error } = await query;

        if (error) {
            console.error("Supabase error fetching students:", error);
            throw error;
        }

        let students = data.map((d, index) => ({
            id: `STU${(index+1).toString().padStart(3, '0')}`,
            name: d.full_name || 'Anonymous Student',
            email: d.email,
            year: d.year
        }));

        res.json({ success: true, data: students });
    } catch (error) {
        next(error);
    }
};

const markAttendance = (req, res, next) => {
    try {
        const { subjectCode, date, attendances } = req.body;
        // attendances: [{ email, status: 'present'|'absent' }]
        
        let allAttendance = JSON.parse(fs.readFileSync(attendanceFile));
        
        allAttendance.push({
            id: Date.now().toString(),
            subjectCode,
            date,
            attendances
        });

        fs.writeFileSync(attendanceFile, JSON.stringify(allAttendance, null, 2));

        res.json({ success: true, message: 'Attendance marked successfully' });
    } catch (error) {
        next(error);
    }
};

const getProgress = (req, res, next) => {
    try {
        const { email } = req.params;
        let allAttendance = JSON.parse(fs.readFileSync(attendanceFile));
        
        // Structure: subjectCode -> { present: number, total: number }
        const progressStats = {};

        // Aggregate from the attendance records
        allAttendance.forEach(record => {
            const studentRecord = record.attendances.find(a => a.email === email);
            if (studentRecord) {
                if (!progressStats[record.subjectCode]) {
                    progressStats[record.subjectCode] = { present: 0, total: 0 };
                }
                progressStats[record.subjectCode].total += 1;
                if (studentRecord.status === 'present') {
                    progressStats[record.subjectCode].present += 1;
                }
            }
        });

        const subjectNames = {
            'CS301': 'Data Structures',
            'CS302': 'Database Systems',
            'CS303': 'Web Development',
            'CS304': 'Operating Systems',
            'CS401': 'Machine Learning',
            'MA301': 'Discrete Mathematics'
        };

        const subjects = [];
        let totalPresent = 0;
        let totalClasses = 0;
        let totalMarks = 0;
        let numSubjects = 0;

        // If no records, we can return some base or empty
        if (Object.keys(progressStats).length === 0) {
            return res.json({
                success: true,
                data: {
                    subjects: [
                        { name: 'Data Structures', attendance: 0, marks: 88, code: 'CS301' },
                        { name: 'Database Systems', attendance: 0, marks: 82, code: 'CS302' }
                    ],
                    overallAttendance: 0,
                    overallMarks: 85
                }
            });
        }

        for (const [code, stats] of Object.entries(progressStats)) {
            const attPct = Math.round((stats.present / stats.total) * 100);
            const marks = 80 + Math.floor(Math.random() * 15); // mock marks
            subjects.push({
                code: code,
                name: subjectNames[code] || code,
                attendance: attPct,
                marks: marks
            });
            totalPresent += stats.present;
            totalClasses += stats.total;
            totalMarks += marks;
            numSubjects += 1;
        }

        const overallAttendance = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;
        const overallMarks = numSubjects > 0 ? Math.round(totalMarks / numSubjects) : 0;

        res.json({
            success: true,
            data: {
                subjects,
                overallAttendance,
                overallMarks
            }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getStudents,
    markAttendance,
    getProgress
};
