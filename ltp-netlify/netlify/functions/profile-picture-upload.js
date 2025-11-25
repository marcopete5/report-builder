// /.netlify/functions/profile-picture-upload
// Upload profile picture for student
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { verifyToken } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS')
        return { statusCode: 204, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'POST')
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    try {
        console.log('[Profile Picture Upload] Starting upload process');

        // Verify authentication
        const authHeader = event.headers['authorization'] || event.headers['Authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('[Profile Picture Upload] No auth header found');
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        const token = authHeader.substring(7);
        const decoded = verifyToken(token);

        if (!decoded) {
            console.log('[Profile Picture Upload] Invalid token');
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

        console.log('[Profile Picture Upload] User authenticated:', decoded.email);

        // Parse the request body
        const body = JSON.parse(event.body);
        const { imageData, studentId } = body;

        console.log('[Profile Picture Upload] Request data:', {
            studentId,
            hasImageData: !!imageData,
            imageDataLength: imageData ? imageData.length : 0
        });

        if (!studentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Student ID is required' })
            };
        }

        // Allow null for removal, otherwise validate
        if (imageData !== null) {
            // Validate image data (should be a data URL)
            if (typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Invalid image data. Must be a data URL starting with data:image/' })
                };
            }

            // Check file size (limit to 2MB)
            const sizeInBytes = (imageData.length * 3) / 4;
            const maxSize = 2 * 1024 * 1024; // 2MB
            if (sizeInBytes > maxSize) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Image too large. Maximum size is 2MB' })
                };
            }
        }

        const db = await getDb();
        const studentsColl = db.collection('students');
        const usersColl = db.collection('users');

        // Verify student ownership or admin access
        const user = await usersColl.findOne({ email: decoded.email });
        if (!user) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        // Students can only update their own profile, admins can update any
        if (user.role === 'student' && user.studentId !== studentId) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Forbidden' })
            };
        }

        // Update the student's profile picture (create document if it doesn't exist)
        const updateData = {
            profilePictureUrl: imageData,
            updatedAt: new Date()
        };

        // If upserting and imageData is not null, also set studentId and studentName
        const setOnInsert = imageData !== null ? {
            studentId: studentId,
            studentName: user.email.split('@')[0] || 'Student'
        } : {};

        console.log('[Profile Picture Upload] Updating MongoDB for studentId:', studentId);
        console.log('[Profile Picture Upload] Update operation:', {
            matched: !!setOnInsert.studentId,
            isRemoval: imageData === null
        });

        const result = await studentsColl.updateOne(
            { studentId },
            {
                $set: updateData,
                $setOnInsert: setOnInsert
            },
            { upsert: true }
        );

        console.log('[Profile Picture Upload] MongoDB result:', {
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount,
            upsertedId: result.upsertedId
        });

        // Verify the update by fetching the student
        const updatedStudent = await studentsColl.findOne({ studentId });
        console.log('[Profile Picture Upload] Verified student data:', {
            studentId: updatedStudent?.studentId,
            hasProfilePic: !!updatedStudent?.profilePictureUrl,
            profilePicLength: updatedStudent?.profilePictureUrl?.length || 0
        });

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                message: imageData ? 'Profile picture updated successfully' : 'Profile picture removed successfully',
                profilePictureUrl: imageData,
                debug: {
                    matched: result.matchedCount,
                    modified: result.modifiedCount,
                    upserted: result.upsertedCount
                }
            })
        };
    } catch (e) {
        console.error('Profile picture upload error:', e);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Server error',
                message: e.message
            })
        };
    }
};
