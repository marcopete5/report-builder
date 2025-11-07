// /.netlify/functions/pace-seed
// Delete all submissions and generate new ones to match pace categories

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { MOCK_STUDENTS } = require('./utils/mock-data');

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
        const entriesCollection = db.collection('lesson_entries');
        const lessonsCollection = db.collection('lessons');

        // Delete all existing submissions
        const deleteResult = await entriesCollection.deleteMany({});

        // Get all lessons sorted by curriculum order
        const allLessons = await lessonsCollection
            .find({ courseId: 'Web Development' })
            .toArray();

        // Sort lessons by level, sectionOrder, lessonOrder
        const sortedLessons = allLessons.sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level;
            if (a.sectionOrder !== b.sectionOrder) return a.sectionOrder - b.sectionOrder;
            return a.lessonOrder - b.lessonOrder;
        });

        const totalLessons = sortedLessons.length;

        const today = new Date();
        const submissions = [];

        // Helper function to calculate expected curriculum index for a student
        function getExpectedIndex(studentId, studentData) {
            const startDate = new Date(studentData.startDate);
            const endDate = new Date(studentData.endDate);
            const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            const daysElapsed = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));

            // Expected progress as percentage
            const expectedProgress = totalDays > 0 ? daysElapsed / totalDays : 0;
            return Math.floor(expectedProgress * totalLessons);
        }

        // Target story points for each student (with ±3-4 variance)
        const targetStoryPoints = {
            rec001: 100,  // Behind
            rec002: 300,  // On Pace
            rec003: 380,  // Ahead
            rec004: 497   // Ahead (complete)
        };

        // Generate submissions for each student
        for (const [studentId, studentData] of Object.entries(MOCK_STUDENTS)) {
            const targetSP = targetStoryPoints[studentId];
            if (!targetSP) continue;

            let currentSP = 0;
            let lessonsCompleted = 0;

            // Add lessons sequentially until we reach target story points (±3-4)
            for (let i = 0; i < sortedLessons.length && currentSP < targetSP; i++) {
                const lesson = sortedLessons[i];
                const lessonSP = parseInt(lesson.storyPoints || 0, 10);

                // Check if adding this lesson would overshoot by more than 4 points
                // If so, and we're within ±4 of target, stop
                if (currentSP + lessonSP > targetSP + 4 && Math.abs(currentSP - targetSP) <= 4) {
                    break;
                }

                currentSP += lessonSP;
                lessonsCompleted++;

                const startDate = new Date(studentData.startDate);
                const daysSinceStart = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));

                // Distribute submissions evenly over the elapsed time
                const submissionDay = Math.floor((i / sortedLessons.length) * daysSinceStart);
                const submissionDate = new Date(startDate.getTime() + submissionDay * 24 * 60 * 60 * 1000);

                submissions.push({
                    studentId,
                    studentName: studentData.name,
                    lessonId: lesson.lessonId,
                    lessonTitle: lesson.title,
                    createdAt: submissionDate
                });
            }

        }

        // Insert all submissions
        if (submissions.length > 0) {
            await entriesCollection.insertMany(submissions);
        }

        return {
            statusCode: 201,
            headers: { ...getCorsHeaders('POST,OPTIONS'), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Pace seed data created successfully',
                deleted: deleteResult.deletedCount,
                created: submissions.length,
                breakdown: Object.entries(MOCK_STUDENTS).map(([id, data]) => ({
                    studentId: id,
                    submissions: submissions.filter(s => s.studentId === id).length
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
