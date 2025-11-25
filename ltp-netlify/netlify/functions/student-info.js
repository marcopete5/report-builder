// /.netlify/functions/student-info
// Get student information including profile picture
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { verifyToken } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS')
        return { statusCode: 204, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'GET')
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    try {
        // Verify authentication
        const authHeader = event.headers['authorization'] || event.headers['Authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        const token = authHeader.substring(7);
        const decoded = verifyToken(token);

        if (!decoded) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

        const q = event.queryStringParameters || {};
        const studentId = q.studentId;

        if (!studentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'studentId required' })
            };
        }

        const db = await getDb();
        const studentsColl = db.collection('students');
        const usersColl = db.collection('users');

        // Verify access
        const user = await usersColl.findOne({ email: decoded.email });
        if (!user) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        // Students can only view their own profile, admins can view any
        if (user.role === 'student' && user.studentId !== studentId) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Forbidden' })
            };
        }

        // Get student data
        const student = await studentsColl.findOne({ studentId });

        if (!student) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Student not found' })
            };
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                studentId: student.studentId,
                studentName: student.studentName,
                course: student.course,
                institution: student.institution,
                profilePictureUrl: student.profilePictureUrl || null,
                courseStartDate: student.courseStartDate,
                courseEndDate: student.courseEndDate
            })
        };
    } catch (e) {
        console.error('Student info error:', e);
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
