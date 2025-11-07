// /.netlify/functions/migrate-student-relationships
// One-time migration to backfill bidirectional relationships
// Adds all existing lesson_entries and lesson_feedback IDs to student records

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const db = await getDb();

        const studentsCollection = db.collection('students');
        const entriesCollection = db.collection('lesson_entries');
        const feedbackCollection = db.collection('lesson_feedback');

        let stats = {
            studentsProcessed: 0,
            entriesLinked: 0,
            feedbackLinked: 0,
            errors: []
        };

        // Get all students
        const students = await studentsCollection.find({}).toArray();

        for (const student of students) {
            try {
                const studentId = student.studentId;

                // Find all lesson entries for this student
                const entries = await entriesCollection
                    .find({ studentId })
                    .project({ _id: 1 })
                    .toArray();

                const entryIds = entries.map(e => e._id);

                // Find all feedback for this student
                const feedbacks = await feedbackCollection
                    .find({ studentId })
                    .project({ _id: 1 })
                    .toArray();

                const feedbackIds = feedbacks.map(f => f._id);

                // Update student record with arrays of IDs
                await studentsCollection.updateOne(
                    { studentId },
                    {
                        $set: {
                            lessonEntries: entryIds,
                            lessonFeedback: feedbackIds,
                            migratedAt: new Date()
                        }
                    }
                );

                stats.studentsProcessed++;
                stats.entriesLinked += entryIds.length;
                stats.feedbackLinked += feedbackIds.length;

            } catch (err) {
                stats.errors.push({
                    studentId: student.studentId,
                    error: err.message
                });
            }
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Migration completed',
                stats
            })
        };

    } catch (err) {
        console.error('Migration error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Migration failed',
                details: err.message
            })
        };
    }
};
