// /.netlify/functions/users-delete
// Delete a user (admin only)

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin, isSuperAdmin, getUserFromEvent } = require('./utils/db-auth');
const { ObjectId } = require('mongodb');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('DELETE,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'DELETE') {
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
        const q = event.queryStringParameters || {};
        const userId = q.id;
        const currentUser = getUserFromEvent(event);

        if (!userId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'User ID required' })
            };
        }

        const db = await getDb();
        const usersColl = db.collection('users');

        // Check what user is being deleted
        const userToDelete = await usersColl.findOne({ _id: new ObjectId(userId) });

        if (!userToDelete) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        // Only superadmins can delete admin or superadmin accounts
        if ((userToDelete.role === 'admin' || userToDelete.role === 'superadmin') && !isSuperAdmin(currentUser)) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Forbidden',
                    message: 'Only superadmins can delete admin accounts'
                })
            };
        }

        // Prevent deleting yourself
        if (userToDelete.email === currentUser.email) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Forbidden',
                    message: 'You cannot delete your own account'
                })
            };
        }

        const result = await usersColl.deleteOne({ _id: new ObjectId(userId) });

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, message: 'User deleted' })
        };
    } catch (err) {
        console.error('Error deleting user:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
