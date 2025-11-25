// /.netlify/functions/check-missing-lesson
// Check if a lesson exists in the database and which courses it belongs to
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const q = event.queryStringParameters || {};
        const lessonId = q.lessonId || 'L1-LEARNING-003';

        const db = await getDb();
        const lessonsColl = db.collection('lessons');

        // Find this lesson in any course
        const allMatches = await lessonsColl.find({ lessonId }).toArray();

        // Find all lessons with similar titles
        const titleMatches = await lessonsColl.find({
            title: /learning to learn/i
        }).toArray();

        // Get all unique lessonIds that contain "LEARNING"
        const learningLessons = await lessonsColl.find({
            lessonId: /LEARNING/i
        }).toArray();

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                searchedLessonId: lessonId,
                exactMatches: allMatches.length,
                lessons: allMatches,
                titleMatches: titleMatches,
                allLearningLessons: learningLessons,
                diagnosis: allMatches.length === 0
                    ? `Lesson ${lessonId} does not exist in the database`
                    : `Lesson ${lessonId} exists in ${allMatches.length} course(s)`
            }, null, 2)
        };
    } catch (e) {
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
