// /.netlify/functions/auth-reset-request
// Request a password reset - generates a reset token

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
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
        const { email } = JSON.parse(event.body || '{}');

        if (!email) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Email is required' })
            };
        }

        const db = await getDb();
        const usersColl = db.collection('users');

        // Find user by email
        const user = await usersColl.findOne({ email: email.toLowerCase() });

        // Always return success even if user doesn't exist (security best practice)
        // This prevents email enumeration attacks
        if (!user) {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    message: 'If an account exists with that email, a password reset link has been sent.'
                })
            };
        }

        // Generate reset token (random 32 bytes = 64 hex characters)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

        // Store reset token in database
        await usersColl.updateOne(
            { _id: user._id },
            {
                $set: {
                    resetToken: resetTokenHash,
                    resetTokenExpiry: resetTokenExpiry
                }
            }
        );

        // Generate reset URL
        const resetUrl = `${event.headers.origin || 'http://localhost:8888'}/reset-password.html?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

        // TODO: Send email with reset link
        // For now, we'll return the link in the response (development only)
        // In production, this should send an email instead

        console.log('Password Reset Link:', resetUrl);
        console.log('This link expires in 1 hour');

        // Check if we have email configuration
        const hasEmailConfig = process.env.SENDGRID_API_KEY || process.env.SMTP_HOST;

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'If an account exists with that email, a password reset link has been sent.',
                // Only include this in development
                ...(process.env.NODE_ENV !== 'production' && {
                    dev: {
                        resetUrl,
                        note: 'In production, this would be sent via email. Configure SENDGRID_API_KEY or SMTP settings to enable emails.'
                    }
                })
            })
        };
    } catch (err) {
        console.error('Password reset request error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error. Please try again.' })
        };
    }
};
