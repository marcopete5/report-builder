// /.netlify/functions/users-create
// Create a new user (admin only)

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin, hashPassword, isSuperAdmin, getUserFromEvent } = require('./utils/db-auth');

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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const { email, password, role, studentId } = JSON.parse(event.body || '{}');
        const currentUser = getUserFromEvent(event);

        // Validation
        if (!email || !password || !role) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Validation failed',
                    details: ['email, password, and role are required']
                })
            };
        }

        // Check role permissions
        const allowedRoles = isSuperAdmin(currentUser)
            ? ['superadmin', 'admin', 'student']
            : ['student']; // Regular admins can only create students

        if (!allowedRoles.includes(role)) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Forbidden',
                    details: isSuperAdmin(currentUser)
                        ? [`role must be one of: ${allowedRoles.join(', ')}`]
                        : ['Only superadmins can create admin accounts. You can only create student accounts.']
                })
            };
        }

        if (role === 'student' && !studentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Validation failed',
                    details: ['studentId is required for student users']
                })
            };
        }

        const db = await getDb();
        const usersColl = db.collection('users');

        // Check if user already exists
        const existingUser = await usersColl.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'User already exists',
                    details: ['A user with this email already exists']
                })
            };
        }

        // Create user
        const newUser = {
            email: email.toLowerCase(),
            passwordHash: hashPassword(password),
            role,
            studentId: role === 'student' ? studentId : null,
            active: true,
            createdAt: new Date(),
            lastLogin: null
        };

        const result = await usersColl.insertOne(newUser);

        return {
            statusCode: 201,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                user: {
                    id: result.insertedId.toString(),
                    email: newUser.email,
                    role: newUser.role,
                    studentId: newUser.studentId,
                    active: newUser.active
                }
            })
        };
    } catch (err) {
        console.error('Error creating user:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
