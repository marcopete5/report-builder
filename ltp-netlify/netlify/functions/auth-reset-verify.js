// /.netlify/functions/auth-reset-verify
// Verify reset token and set new password

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { hashPassword } = require('./utils/db-auth');
const crypto = require('crypto');

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
        const { email, token, newPassword } = JSON.parse(event.body || '{}');

        if (!email || !token || !newPassword) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Email, token, and new password are required' })
            };
        }

        if (newPassword.length < 8) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Password must be at least 8 characters long' })
            };
        }

        const db = await getDb();
        const usersColl = db.collection('users');

        // Hash the token to compare with stored hash
        const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

        // Find user with matching email and reset token
        const user = await usersColl.findOne({
            email: email.toLowerCase(),
            resetToken: resetTokenHash
        });

        if (!user) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Invalid or expired reset token' })
            };
        }

        // Check if token is expired
        if (!user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Reset token has expired. Please request a new one.' })
            };
        }

        // Update password and clear reset token
        await usersColl.updateOne(
            { _id: user._id },
            {
                $set: {
                    passwordHash: hashPassword(newPassword)
                },
                $unset: {
                    resetToken: '',
                    resetTokenExpiry: ''
                }
            }
        );

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Password reset successfully. You can now log in with your new password.'
            })
        };
    } catch (err) {
        console.error('Password reset verify error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error. Please try again.' })
        };
    }
};
