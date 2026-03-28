const errorHandler = (err, req, res, next) => {
    console.error('Global API Error:', err.message || err);
    res.status(500).json({ error: err.message || 'Server error' });
};

module.exports = errorHandler;
