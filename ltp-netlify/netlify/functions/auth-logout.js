// /.netlify/functions/auth-logout
// Logout endpoint

const { getCorsHeaders } = require('./utils/cors');

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

    return {
        statusCode: 200,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Set-Cookie': 'auth_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
        },
        body: JSON.stringify({ success: true, message: 'Logged out successfully' })
    };
};
