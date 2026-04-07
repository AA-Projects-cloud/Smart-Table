const multer = require('multer');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/db');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const sanitized = file.originalname.replace(/[\s]+/g, '_');
        cb(null, `${timestamp}_${sanitized}`);
    }
});

const allowed = ['.pdf', '.docx', '.doc', '.txt', '.ppt', '.pptx', '.json'];

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only PDF, DOC/DOCX, PPT/PPTX, TXT, and JSON files are allowed'));
    }
};

const upload = multer({ storage, fileFilter });

const uploadFile = async (req, res, next) => {
    try {
        console.log('Upload request received:', { 
            file: req.file ? req.file.originalname : 'none',
            body: req.body 
        });

        if (!req.file) {
            return res.status(400).json({ error: 'File required' });
        }

        const { subjectCode, type, title } = req.body;
        
        console.log('Inserting into Supabase resources table...');
        const { data, error } = await supabase
            .from('resources')
            .insert([{
                subject_code: subjectCode,
                type: type, // 'Resource' or 'Assignment'
                title: title || req.file.originalname,
                file_name: req.file.filename,
                file_path: `/uploads/${req.file.filename}`,
                size: (req.file.size / 1024).toFixed(1) + ' KB',
                date: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) {
            console.error('Supabase insertion error:', error);
            throw error;
        }

        console.log('Supabase insertion success:', data.id);

        res.json({
            success: true,
            data: {
                id: data.id,
                title: data.title,
                fileName: data.file_name,
                path: data.file_path,
                size: data.size,
                date: data.date,
                type: data.type
            }
        });
    } catch (error) {
        next(error);
    }
};

const getResourcesBySubject = async (req, res, next) => {
    try {
        const { subjectCode } = req.params;
        const { data, error } = await supabase
            .from('resources')
            .select('*')
            .eq('subject_code', subjectCode);

        if (error) throw error;
        
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

const getAllResources = async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('resources')
            .select('*');

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

const downloadFile = (req, res, next) => {
    try {
        const filePath = path.join(uploadDir, req.params.name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.download(filePath);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    upload,
    uploadFile,
    getResourcesBySubject,
    getAllResources,
    downloadFile
};
