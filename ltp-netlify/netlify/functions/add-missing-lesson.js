// /.netlify/functions/add-missing-lesson
// Add missing lesson to a course
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const db = await getDb();
        const lessonsColl = db.collection('lessons');

        // Add the "Learning to Learn" lesson to Cybersecurity
        const newLesson = {
            lessonId: 'L1-LEARNING-003',
            title: 'Learning to Learn',
            courseId: 'Cybersecurity',
            level: 1,
            section: 'Learning',
            sectionOrder: 0, // First section
            lessonOrder: 3,
            storyPoints: 1,
            description: 'Introduction to learning strategies and techniques',
            createdAt: new Date()
        };

        // Check if it already exists
        const existing = await lessonsColl.findOne({
            lessonId: newLesson.lessonId,
            courseId: newLesson.courseId
        });

        let result;
        if (existing) {
            result = {
                action: 'already_exists',
                message: 'Lesson already exists for this course',
                lesson: existing
            };
        } else {
            const insertResult = await lessonsColl.insertOne(newLesson);
            result = {
                action: 'inserted',
                message: 'Lesson successfully added',
                insertedId: insertResult.insertedId,
                lesson: newLesson
            };
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(result, null, 2)
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
