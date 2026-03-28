const supabase = require('../config/db');

// Send a global notification
exports.sendGlobalNotification = async (req, res, next) => {
    try {
        const { title, message, type, recipient_role } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'Title and message are required' });
        }

        const { data, error } = await supabase
            .from('notifications')
            .insert([
                { 
                    title, 
                    message, 
                    type: type || 'info', 
                    recipient_role: recipient_role || 'all',
                    created_at: new Date().toISOString()
                }
            ])
            .select();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: 'Notification sent successfully',
            data: data[0]
        });
    } catch (error) {
        next(error);
    }
};

// Get recent notifications
exports.getNotifications = async (req, res, next) => {
    try {
        const { role } = req.query;
        
        let query = supabase
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (role && role !== 'all') {
            query = query.or(`recipient_role.eq.${role},recipient_role.eq.all`);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};
