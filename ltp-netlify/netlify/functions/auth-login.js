// /.netlify/functions/auth-login
// Login endpoint with MongoDB user storage

const { getCorsHeaders } = require('./utils/cors');
const { verifyCredentials, createToken } = require('./utils/db-auth');
const { getDb } = require('./utils/database');

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

        const user = await verifyCredentials(email, password);

        if (!user) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Invalid email or password' })
            };
        }

        // Update last login time
        const db = await getDb();
        await db.collection('users').updateOne(
            { email: email.toLowerCase() },
            { $set: { lastLogin: new Date() } }
        );

        const token = createToken(user);

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Set-Cookie': `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
            },
            body: JSON.stringify({
                success: true,
                token,
                user: {
                    email: user.email,
                    role: user.role,
                    studentId: user.studentId
                }
            })
        };
    } catch (err) {
        console.error('Login error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error' })
        };
    }
};
