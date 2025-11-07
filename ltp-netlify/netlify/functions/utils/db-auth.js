// Database-based authentication
// Users stored in MongoDB instead of environment variables

const crypto = require('crypto');
const { getDb } = require('./database');

/**
 * Hash a password for storage
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Verify login credentials against MongoDB
 * @param {string} email
 * @param {string} password
 * @returns {Object|null} User object if valid, null otherwise
 */
async function verifyCredentials(email, password) {
    try {
        const db = await getDb();
        const usersColl = db.collection('users');

        const user = await usersColl.findOne({
            email: email.toLowerCase(),
            active: true
        });

        if (!user) {
            return null;
        }

        const passwordHash = hashPassword(password);

        if (passwordHash === user.passwordHash) {
            return {
                id: user._id.toString(),
                email: user.email,
                role: user.role,
                studentId: user.studentId || null
            };
        }

        return null;
    } catch (err) {
        console.error('Error verifying credentials:', err);
        return null;
    }
}

/**
 * Create a JWT token
 * @param {Object} user
 * @returns {string} JWT token
 */
function createToken(user) {
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        studentId: user.studentId,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 days
    };

    const secret = process.env.JWT_SECRET || 'change-me-in-production';
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

    return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a JWT token
 * @param {string} token
 * @returns {Object|null} Decoded user object if valid, null otherwise
 */
function verifyToken(token) {
    if (!token) return null;

    try {
        const secret = process.env.JWT_SECRET || 'change-me-in-production';
        const parts = token.split('.');

        if (parts.length !== 3) return null;

        const [header, body, signature] = parts;

        // Verify signature
        const expectedSignature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
        if (signature !== expectedSignature) return null;

        // Decode payload
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());

        // Check expiration
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }

        return {
            id: payload.id,
            email: payload.email,
            role: payload.role,
            studentId: payload.studentId
        };
    } catch (err) {
        console.error('Token verification error:', err);
        return null;
    }
}

/**
 * Extract user from Authorization header or cookie
 * @param {Object} event - Netlify function event
 * @returns {Object|null} User object if authenticated, null otherwise
 */
function getUserFromEvent(event) {
    // Try Authorization header first
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        return verifyToken(token);
    }

    // Try cookie
    const cookies = event.headers.cookie || '';
    const tokenMatch = cookies.match(/auth_token=([^;]+)/);
    if (tokenMatch) {
        return verifyToken(tokenMatch[1]);
    }

    return null;
}

/**
 * Check if user is authenticated
 */
function requireAuth(event) {
    const user = getUserFromEvent(event);

    if (!user) {
        return {
            authenticated: false,
            user: null,
            error: 'Authentication required. Please log in.'
        };
    }

    return {
        authenticated: true,
        user,
        error: null
    };
}

/**
 * Check if user has superadmin role
 */
function isSuperAdmin(user) {
    return user && user.role === 'superadmin';
}

/**
 * Check if user has admin role (or superadmin)
 */
function isAdmin(user) {
    return user && (user.role === 'admin' || user.role === 'superadmin');
}

/**
 * Check if user has student role
 */
function isStudent(user) {
    return user && user.role === 'student';
}

/**
 * Check if request wants HTML (for redirect handling)
 */
function wantsHtml(event) {
    const q = event.queryStringParameters || {};
    if (String(q.view || '').toLowerCase() === 'html') return true;
    const accept = (event.headers && (event.headers.accept || event.headers.Accept)) || '';
    return accept.includes('text/html');
}

/**
 * Require admin role
 */
function requireAdmin(event, corsHeaders = {}) {
    const auth = requireAuth(event);

    if (!auth.authenticated) {
        // If browser is requesting HTML, redirect to login
        if (wantsHtml(event)) {
            return {
                statusCode: 302,
                headers: {
                    ...corsHeaders,
                    'Location': '/login.html'
                },
                body: ''
            };
        }

        return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: auth.error })
        };
    }

    if (!isAdmin(auth.user)) {
        // If browser is requesting HTML, redirect to login
        if (wantsHtml(event)) {
            return {
                statusCode: 302,
                headers: {
                    ...corsHeaders,
                    'Location': '/login.html'
                },
                body: ''
            };
        }

        return {
            statusCode: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Forbidden. Admin access required.',
                userRole: auth.user.role
            })
        };
    }

    return null;
}

/**
 * Require student role
 */
function requireStudent(event, corsHeaders = {}) {
    const auth = requireAuth(event);

    if (!auth.authenticated) {
        // If browser is requesting HTML, redirect to login
        if (wantsHtml(event)) {
            return {
                statusCode: 302,
                headers: {
                    ...corsHeaders,
                    'Location': '/login.html'
                },
                body: ''
            };
        }

        return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: auth.error })
        };
    }

    if (!isStudent(auth.user) && !isAdmin(auth.user)) {
        // If browser is requesting HTML, redirect to login
        if (wantsHtml(event)) {
            return {
                statusCode: 302,
                headers: {
                    ...corsHeaders,
                    'Location': '/login.html'
                },
                body: ''
            };
        }

        return {
            statusCode: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Forbidden. Student access required.',
                userRole: auth.user.role
            })
        };
    }

    if (isStudent(auth.user) && !auth.user.studentId) {
        // If browser is requesting HTML, redirect to login
        if (wantsHtml(event)) {
            return {
                statusCode: 302,
                headers: {
                    ...corsHeaders,
                    'Location': '/login.html'
                },
                body: ''
            };
        }

        return {
            statusCode: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Student account not properly configured. Missing studentId.'
            })
        };
    }

    return null;
}

/**
 * Get authorized student ID
 */
function getAuthorizedStudentId(event, user) {
    if (isAdmin(user)) {
        const q = event.queryStringParameters || {};
        return q.studentId || null;
    }

    if (isStudent(user)) {
        return user.studentId;
    }

    return null;
}

module.exports = {
    hashPassword,
    verifyCredentials,
    createToken,
    verifyToken,
    getUserFromEvent,
    requireAuth,
    requireAdmin,
    requireStudent,
    isSuperAdmin,
    isAdmin,
    isStudent,
    getAuthorizedStudentId
};
