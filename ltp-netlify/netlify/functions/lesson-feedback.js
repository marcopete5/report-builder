// /.netlify/functions/lesson-feedback
// Accepts POST JSON from feedback.js and stores in MongoDB (lesson_feedback)
const { getDb, createLessonFeedbackIndexes, createStudentIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS')
        return { statusCode: 204, headers: getCorsHeaders('GET,POST,OPTIONS'), body: '' };

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: getCorsHeaders('GET,POST,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const db = await getDb();
        await createLessonFeedbackIndexes(db);
        await createStudentIndexes(db);

        const body = JSON.parse(event.body || '{}');

        const {
            studentName,
            studentId,
            courseId,
            lessonId,
            lessonTitle,
            feedbackType,
            feedbackText,
            pageUrl,
            utm = {},
            extra = {}
        } = body;

        if (!studentName || !studentId || !lessonId || !feedbackType || !feedbackText) {
            return {
                statusCode: 400,
                headers: getCorsHeaders('GET,POST,OPTIONS'),
                body: JSON.stringify({
                    error: 'studentName, studentId, lessonId, feedbackType, feedbackText are required'
                })
            };
        }

        const doc = {
            createdAt: new Date(),
            studentName,
            studentId, // Now required
            courseId: courseId || null,
            lessonId,
            lessonTitle: lessonTitle || null,
            feedbackType,
            feedbackText,
            pageUrl: pageUrl || null,
            utm: {
                source: utm.source || null,
                medium: utm.medium || null,
                campaign: utm.campaign || null,
                term: utm.term || null,
                content: utm.content || null
            },
            userAgent: (event.headers && event.headers['user-agent']) || null,
            ip:
                event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
                null,
            extra
        };

        const result = await db.collection('lesson_feedback').insertOne(doc);
        const feedbackId = result.insertedId;

        // Update student record to maintain bidirectional relationship
        try {
            await db.collection('students').updateOne(
                { studentId },
                {
                    $addToSet: {
                        lessonFeedback: feedbackId // Add feedback ID to student's lessonFeedback array
                    },
                    $set: {
                        lastFeedbackAt: new Date()
                    },
                    $setOnInsert: {
                        studentId,
                        studentName,
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
        } catch (dbErr) {
            console.error('Failed to update student record with feedback:', {
                studentId,
                feedbackId,
                error: dbErr.message
            });
            // Continue - the feedback was already saved
        }

        // Optional: forward to Zapier
        if (process.env.ZAPIER_FEEDBACK_HOOK_URL) {
            try {
                await fetch(process.env.ZAPIER_FEEDBACK_HOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...doc,
                        insertedId: result.insertedId
                    })
                });
            } catch (e) {
            }
        }

        return {
            statusCode: 200,
            headers: getCorsHeaders('GET,POST,OPTIONS'),
            body: JSON.stringify({ ok: true, insertedId: result.insertedId })
        };
    } catch (e) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,POST,OPTIONS'),
            body: JSON.stringify({ error: 'Server error' })
        };
    }
};
