// /.netlify/functions/auth-me
// Get current user info

const { getCorsHeaders } = require('./utils/cors');
const { getUserFromEvent } = require('./utils/db-auth');

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

    const user = getUserFromEvent(event);

    if (!user) {
        return {
            statusCode: 401,
            headers: corsHeaders,
            body: JSON.stringify({ authenticated: false })
        };
    }

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            authenticated: true,
            user: {
                email: user.email,
                role: user.role,
                studentId: user.studentId
            }
        })
    };
};
