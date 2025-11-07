// /.netlify/functions/auth-signup
// Public signup endpoint for new users
// Creates student accounts by default (admins must be created via admin UI)

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { hashPassword, createToken } = require('./utils/db-auth');

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
        const { email, password, studentId } = JSON.parse(event.body || '{}');

        // Validation
        if (!email || !password) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Email and password are required'
                })
            };
        }

        if (!studentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Student ID is required. Please enter your Airtable student ID.'
                })
            };
        }

        // Password strength check
        if (password.length < 8) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Password must be at least 8 characters long'
                })
            };
        }

        const db = await getDb();
        const usersColl = db.collection('users');
        const studentsColl = db.collection('students');

        // Check if email already exists
        const existingUser = await usersColl.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'An account with this email already exists'
                })
            };
        }

        // Verify studentId exists in students collection
        const student = await studentsColl.findOne({ studentId });
        if (!student) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Student ID not found. Please check your student ID or contact an administrator.'
                })
            };
        }

        // Create student user account
        const newUser = {
            email: email.toLowerCase(),
            passwordHash: hashPassword(password),
            role: 'student',
            studentId: studentId,
            active: true,
            createdAt: new Date(),
            lastLogin: null
        };

        const result = await usersColl.insertOne(newUser);

        // Create token for immediate login
        const user = {
            id: result.insertedId.toString(),
            email: newUser.email,
            role: newUser.role,
            studentId: newUser.studentId
        };

        const token = createToken(user);

        // Update last login
        await usersColl.updateOne(
            { _id: result.insertedId },
            { $set: { lastLogin: new Date() } }
        );

        return {
            statusCode: 201,
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
                },
                message: 'Account created successfully! You are now logged in.'
            })
        };
    } catch (err) {
        console.error('Signup error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error. Please try again.' })
        };
    }
};
