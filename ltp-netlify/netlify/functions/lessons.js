// /.netlify/functions/lessons
// Manage lessons with story points

const { ObjectId } = require('mongodb');
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');

async function createLessonIndexes(db) {
    try {
        await db.collection('lessons').createIndexes([
            { key: { lessonId: 1 }, name: 'lessonId_unique', unique: true },
            { key: { courseId: 1 }, name: 'courseId_idx' }
        ]);
    } catch (err) {
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'), body: '' };
    }

    try {
        const db = await getDb();
        await createLessonIndexes(db);
        const coll = db.collection('lessons');

        // GET - List all lessons or get by lessonId
        if (event.httpMethod === 'GET') {
            const q = event.queryStringParameters || {};
            const lessonId = q.lessonId;

            if (lessonId) {
                // Get specific lesson
                const lesson = await coll.findOne({ lessonId });
                if (!lesson) {
                    return {
                        statusCode: 404,
                        headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                        body: JSON.stringify({ error: 'Lesson not found' })
                    };
                }
                return {
                    statusCode: 200,
                    headers: { ...getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'), 'Content-Type': 'application/json' },
                    body: JSON.stringify(lesson)
                };
            } else {
                // List all lessons
                const courseId = q.courseId;
                const filter = courseId ? { courseId } : {};
                const lessons = await coll
                    .find(filter)
                    .sort({ lessonId: 1 })
                    .toArray();

                return {
                    statusCode: 200,
                    headers: { ...getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lessons })
                };
            }
        }

        // POST - Create new lesson
        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const { lessonId, title, storyPoints, courseId, description } = body;

            if (!lessonId || !title || storyPoints === undefined) {
                return {
                    statusCode: 400,
                    headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                    body: JSON.stringify({
                        error: 'lessonId, title, and storyPoints are required'
                    })
                };
            }

            const lesson = {
                lessonId,
                title,
                storyPoints: parseInt(storyPoints, 10),
                courseId: courseId || null,
                description: description || null,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            try {
                const result = await coll.insertOne(lesson);
                return {
                    statusCode: 201,
                    headers: { ...getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: 'Lesson created',
                        lessonId: lesson.lessonId,
                        id: result.insertedId
                    })
                };
            } catch (err) {
                if (err.code === 11000) {
                    return {
                        statusCode: 409,
                        headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                        body: JSON.stringify({
                            error: 'Lesson with this lessonId already exists'
                        })
                    };
                }
                throw err;
            }
        }

        // PUT - Update lesson
        if (event.httpMethod === 'PUT') {
            const q = event.queryStringParameters || {};
            const lessonId = q.lessonId;

            if (!lessonId) {
                return {
                    statusCode: 400,
                    headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                    body: JSON.stringify({ error: 'lessonId is required' })
                };
            }

            const body = JSON.parse(event.body || '{}');
            const updates = {};

            if (body.title !== undefined) updates.title = body.title;
            if (body.storyPoints !== undefined)
                updates.storyPoints = parseInt(body.storyPoints, 10);
            if (body.courseId !== undefined) updates.courseId = body.courseId;
            if (body.description !== undefined)
                updates.description = body.description;

            updates.updatedAt = new Date();

            const result = await coll.updateOne(
                { lessonId },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return {
                    statusCode: 404,
                    headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                    body: JSON.stringify({ error: 'Lesson not found' })
                };
            }

            return {
                statusCode: 200,
                headers: { ...getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'), 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Lesson updated', lessonId })
            };
        }

        // DELETE - Delete lesson
        if (event.httpMethod === 'DELETE') {
            const q = event.queryStringParameters || {};
            const lessonId = q.lessonId;

            if (!lessonId) {
                return {
                    statusCode: 400,
                    headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                    body: JSON.stringify({ error: 'lessonId is required' })
                };
            }

            const result = await coll.deleteOne({ lessonId });

            if (result.deletedCount === 0) {
                return {
                    statusCode: 404,
                    headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
                    body: JSON.stringify({ error: 'Lesson not found' })
                };
            }

            return {
                statusCode: 200,
                headers: { ...getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'), 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Lesson deleted', lessonId })
            };
        }

        return {
            statusCode: 405,
            headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS'),
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
