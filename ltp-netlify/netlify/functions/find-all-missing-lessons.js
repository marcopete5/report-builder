// /.netlify/functions/find-all-missing-lessons
// Find all lesson entries that don't have corresponding lessons in the database
const { getDb, createStudentIndexes, createLessonEntryIndexes } = require('./utils/database');
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
        const db = await getDb();
        await createStudentIndexes(db);
        await createLessonEntryIndexes(db);

        const lessonEntriesColl = db.collection('lesson_entries');
        const lessonsColl = db.collection('lessons');
        const studentsColl = db.collection('students');

        // Get all unique lessonIds from lesson_entries
        const submittedLessonIds = await lessonEntriesColl.distinct('lessonId');

        // Get all lessonIds from lessons collection
        const availableLessons = await lessonsColl.find({}).toArray();
        const availableLessonIds = new Set(availableLessons.map(l => l.lessonId));

        // Find missing lessons
        const missingLessonIds = submittedLessonIds.filter(
            id => !availableLessonIds.has(id)
        );

        // Get details for each missing lesson
        const missingDetails = [];
        for (const lessonId of missingLessonIds) {
            const entries = await lessonEntriesColl
                .find({ lessonId })
                .limit(5)
                .toArray();

            const uniqueStudents = await lessonEntriesColl
                .distinct('studentId', { lessonId });

            // Get courses for these students
            const students = await studentsColl
                .find({ studentId: { $in: uniqueStudents } })
                .toArray();

            const courses = [...new Set(students.map(s => s.course).filter(Boolean))];

            missingDetails.push({
                lessonId,
                lessonTitle: entries[0]?.lessonTitle || 'Unknown',
                submissionCount: entries.length,
                affectedStudents: uniqueStudents.length,
                courses: courses,
                sampleSubmissions: entries.slice(0, 3).map(e => ({
                    studentId: e.studentId,
                    studentName: e.studentName,
                    createdAt: e.createdAt
                }))
            });
        }

        // Group by course
        const byCourse = {};
        for (const detail of missingDetails) {
            for (const course of detail.courses) {
                if (!byCourse[course]) {
                    byCourse[course] = [];
                }
                byCourse[course].push(detail.lessonId);
            }
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                summary: {
                    totalSubmittedLessons: submittedLessonIds.length,
                    totalAvailableLessons: availableLessons.length,
                    missingCount: missingLessonIds.length
                },
                missingByLesson: missingDetails,
                missingByCourse: byCourse,
                recommendations: missingLessonIds.length > 0
                    ? [
                        `Found ${missingLessonIds.length} lessons that students have submitted but don't exist in the database`,
                        'These lessons need to be added to the lessons collection',
                        'This is why students show level 0 even though they have submissions'
                    ]
                    : ['No missing lessons found - all submissions match lessons in the database']
            }, null, 2)
        };
    } catch (e) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Server error',
                message: e.message,
                stack: e.stack
            })
        };
    }
};
