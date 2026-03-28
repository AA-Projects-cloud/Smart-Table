const { createClerkClient } = require('@clerk/clerk-sdk-node');

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || process.env.CLERK_API_KEY });

const verifyClerkSession = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required starting with Bearer' });
    }

    const token = authHeader.split(' ')[1];

    try {
        console.log('Verifying token:', token.substring(0, 10) + '...');
        const verifiedToken = await clerk.verifyToken(token);
        console.log('Token verified for sub:', verifiedToken.sub);
        
        req.user = { id: verifiedToken.sub, ...verifiedToken };
        return next();
    } catch (error) {
        console.error('Clerk session invalid:', error.message || error);
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
};

module.exports = { verifyClerkSession };
