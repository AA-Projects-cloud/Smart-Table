const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Fetch user profile
exports.getProfile = async (req, res) => {
    try {
        const { email } = req.params;
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('email', email)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is 'not found'
            throw error;
        }

        res.status(200).json({ success: true, data: data || null });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create or update profile
exports.saveProfile = async (req, res) => {
    try {
        const { email, full_name, role, year, section, semester, mcq_history, preferences } = req.body;

        // Upsert logic (insert or update on email conflict)
        const { data, error } = await supabase
            .from('user_profiles')
            .upsert({ 
                email, 
                full_name, 
                role, 
                year, 
                section, 
                semester, 
                mcq_history: mcq_history || [],
                preferences: preferences || {},
                updated_at: new Date().toISOString()
            }, { onConflict: 'email' })
            .select();

        if (error) throw error;

        res.status(200).json({ success: true, data: data[0] });
    } catch (error) {
        console.error('Error saving profile:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Add MCQ result to history
exports.addMcqResult = async (req, res) => {
    try {
        const { email, result } = req.body; // result: { title, score, total, date }

        // Get current history
        const { data: profile, error: fetchError } = await supabase
            .from('user_profiles')
            .select('mcq_history')
            .eq('email', email)
            .single();

        if (fetchError) throw fetchError;

        const updatedHistory = [result, ...(profile.mcq_history || [])].slice(0, 50);

        const { error: updateError } = await supabase
            .from('user_profiles')
            .update({ mcq_history: updatedHistory })
            .eq('email', email);

        if (updateError) throw updateError;

        res.status(200).json({ success: true, message: 'Result saved' });
    } catch (error) {
        console.error('Error saving MCQ result:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
