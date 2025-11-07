// /.netlify/functions/users-list
// List all users (admin only)

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const db = await getDb();
        const usersColl = db.collection('users');

        const users = await usersColl.find({})
            .project({
                passwordHash: 0 // Don't return password hashes
            })
            .sort({ createdAt: -1 })
            .toArray();

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                users: users.map(u => ({
                    id: u._id.toString(),
                    email: u.email,
                    role: u.role,
                    studentId: u.studentId || null,
                    active: u.active !== false,
                    createdAt: u.createdAt,
                    lastLogin: u.lastLogin || null
                }))
            })
        };
    } catch (err) {
        console.error('Error listing users:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
