// /.netlify/functions/users-init
// Initialize first admin user (ONLY works if no users exist)
// This is a one-time setup endpoint

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { hashPassword } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { email, password } = JSON.parse(event.body || '{}');

        if (!email || !password) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Email and password required' })
            };
        }

        const db = await getDb();
        const usersColl = db.collection('users');

        // Check if any users exist
        const userCount = await usersColl.countDocuments();

        if (userCount > 0) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Forbidden',
                    message: 'Users already exist. This endpoint only works for initial setup.'
                })
            };
        }

        // Create first admin user
        const adminUser = {
            email: email.toLowerCase(),
            passwordHash: hashPassword(password),
            role: 'admin',
            studentId: null,
            active: true,
            createdAt: new Date(),
            lastLogin: null
        };

        const result = await usersColl.insertOne(adminUser);

        return {
            statusCode: 201,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'First admin user created successfully',
                user: {
                    id: result.insertedId.toString(),
                    email: adminUser.email,
                    role: adminUser.role
                }
            })
        };
    } catch (err) {
        console.error('Error initializing user:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
