// /.netlify/functions/lessons-seed
// Seed initial lesson data with story points

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const fs = require('fs');
const path = require('path');

// Load lessons from allCyberLessons.json
function loadLessons() {
    try {
        // In Netlify functions, __dirname is the functions directory
        // Go up to project root: functions -> netlify -> ltp-netlify -> report-builder
        const filePath = path.join(__dirname, '..', '..', '..', 'allCyberLessons.json');
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (err) {
        throw new Error(
            'Could not load allCyberLessons.json. Make sure the file exists in the project root. Error: ' + err.message
        );
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: getCorsHeaders('POST,OPTIONS'), body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const db = await getDb();
        const coll = db.collection('lessons');

        // Load lessons from allCyberLessons.json
        const loadedLessons = loadLessons();

        // Get all existing lessonIds to avoid duplicates
        const existingLessonIds = await coll.distinct('lessonId');

        // Filter out lessons that already exist
        const newLessons = loadedLessons.filter(
            lesson => !existingLessonIds.includes(lesson.lessonId)
        );

        if (newLessons.length === 0) {
            return {
                statusCode: 400,
                headers: getCorsHeaders('POST,OPTIONS'),
                body: JSON.stringify({
                    error: 'No new lessons to add',
                    message: 'All cyber lessons already exist in the database.'
                })
            };
        }

        // Insert seed data with timestamps
        const lessons = newLessons.map((lesson) => ({
            ...lesson,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        const result = await coll.insertMany(lessons);

        return {
            statusCode: 201,
            headers: { ...getCorsHeaders('POST,OPTIONS'), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Cyber lessons inserted successfully',
                inserted: result.insertedCount,
                totalLessons: lessons.length,
                skipped: loadedLessons.length - newLessons.length,
                sampleLessons: lessons.slice(0, 5).map((l) => ({
                    lessonId: l.lessonId,
                    title: l.title,
                    storyPoints: l.storyPoints,
                    courseId: l.courseId
                }))
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
