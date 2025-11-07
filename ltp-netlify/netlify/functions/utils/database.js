// Shared MongoDB database connection utility
// Reuses a single client across serverless function invocations

const { MongoClient } = require('mongodb');

let client;
let clientPromise;

/**
 * Get MongoDB database connection
 * @param {string} dbName - Optional database name (defaults to env MONGODB_DB or 'Reports')
 * @returns {Promise<Db>} MongoDB database instance
 */
async function getDb(dbName) {
    const uri = process.env.MONGODB_URI;
    const defaultDbName = process.env.MONGODB_DB || 'Reports';
    const targetDb = dbName || defaultDbName;

    if (!uri) {
        throw new Error('Missing MONGODB_URI environment variable');
    }

    // Reuse existing client
    if (!client) {
        client = new MongoClient(uri, { maxPoolSize: 5 });
    }
    if (!clientPromise) {
        clientPromise = client.connect();
    }

    const conn = await clientPromise;
    return conn.db(targetDb);
}

/**
 * Create indexes on lesson_entries collection
 * Safe to call multiple times - will not recreate existing indexes
 * @param {Db} db - MongoDB database instance
 */
async function createLessonEntryIndexes(db) {
    try {
        await db.collection('lesson_entries').createIndexes([
            { key: { createdAt: -1 }, name: 'createdAt_desc' },
            { key: { studentId: 1, createdAt: -1 }, name: 'studentId_createdAt' },
            { key: { lessonId: 1, createdAt: -1 }, name: 'lessonId_createdAt' }
        ]);
    } catch (e) {
    }
}

/**
 * Create indexes on students collection
 * Safe to call multiple times - will not recreate existing indexes
 * @param {Db} db - MongoDB database instance
 */
async function createStudentIndexes(db) {
    try {
        await db.collection('students').createIndexes([
            { key: { studentId: 1 }, name: 'studentId_unique', unique: true },
            { key: { course: 1 }, name: 'course_idx' },
            { key: { institution: 1 }, name: 'institution_idx' },
            { key: { courseEndDate: 1 }, name: 'courseEndDate_idx' },
            { key: { lastSyncedAt: 1 }, name: 'lastSyncedAt_idx' },
            { key: { lessonEntries: 1 }, name: 'lessonEntries_idx' },
            { key: { lessonFeedback: 1 }, name: 'lessonFeedback_idx' }
        ]);
    } catch (e) {
    }
}

/**
 * Create indexes on lesson_feedback collection
 * Safe to call multiple times - will not recreate existing indexes
 * @param {Db} db - MongoDB database instance
 */
async function createLessonFeedbackIndexes(db) {
    try {
        await db.collection('lesson_feedback').createIndexes([
            { key: { createdAt: -1 }, name: 'createdAt_desc' },
            { key: { studentId: 1, createdAt: -1 }, name: 'studentId_createdAt' },
            { key: { lessonId: 1 }, name: 'lessonId_idx' }
        ]);
    } catch (e) {
    }
}

module.exports = {
    getDb,
    createLessonEntryIndexes,
    createStudentIndexes,
    createLessonFeedbackIndexes
};
