// /.netlify/functions/dev-seed
// Generates realistic test data for student lesson submissions
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');

// Generate random date within a range
function randomDate(start, end) {
    return new Date(
        start.getTime() + Math.random() * (end.getTime() - start.getTime())
    );
}

// Generate submissions for a student
function generateStudentSubmissions(
    studentId,
    studentName,
    lessons,
    startDate,
    weeksActive,
    completionRate,
    skipRate = 0.1
) {
    const submissions = [];
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + weeksActive * 7);

    // Calculate how many lessons to complete based on completion rate
    const totalLessons = lessons.length;
    const lessonsToComplete = Math.floor(totalLessons * completionRate);

    // Sort lessons by level, section, lesson order
    const sortedLessons = [...lessons].sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        if (a.sectionOrder !== b.sectionOrder)
            return a.sectionOrder - b.sectionOrder;
        return a.lessonOrder - b.lessonOrder;
    });

    let currentDate = new Date(startDate);

    // Simulate realistic progress over time
    for (let i = 0; i < lessonsToComplete && i < sortedLessons.length; i++) {
        const lesson = sortedLessons[i];

        // Randomly skip some lessons (student might skip ahead)
        if (Math.random() > skipRate) {
            // Add some realistic time progression
            // More story points = more days to complete
            const daysToComplete = Math.max(
                1,
                Math.floor((lesson.storyPoints || 1) * (0.5 + Math.random()))
            );
            currentDate = new Date(currentDate);
            currentDate.setDate(currentDate.getDate() + daysToComplete);

            // Stop if we've exceeded the time range
            if (currentDate > endDate) break;

            // Some students submit multiple times (revisions)
            const numSubmissions =
                Math.random() > 0.8 ? 2 : Math.random() > 0.95 ? 3 : 1;

            for (let s = 0; s < numSubmissions; s++) {
                const submissionDate = new Date(currentDate);
                if (s > 0) {
                    // Revision submitted a bit later
                    submissionDate.setHours(
                        submissionDate.getHours() + Math.random() * 48
                    );
                }

                submissions.push({
                    studentId,
                    studentName,
                    lessonId: lesson.lessonId,
                    lessonTitle: lesson.title,
                    createdAt: submissionDate
                });
            }
        }
    }

    return submissions;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS')
        return { statusCode: 204, headers: getCorsHeaders('POST,OPTIONS'), body: '' };
    if (event.httpMethod !== 'POST')
        return {
            statusCode: 405,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    try {
        const db = await getDb();
        const entriesCollection = db.collection('lesson_entries');
        const lessonsCollection = db.collection('lessons');

        // Get all lessons
        const allLessons = await lessonsCollection
            .find({})
            .sort({ level: 1, sectionOrder: 1, lessonOrder: 1 })
            .toArray();

        if (allLessons.length === 0) {
            return {
                statusCode: 400,
                headers: getCorsHeaders('POST,OPTIONS'),
                body: JSON.stringify({
                    error: 'No lessons found. Please seed lessons first using /lessons-seed'
                })
            };
        }

        // Clear existing submissions
        const deleteResult = await entriesCollection.deleteMany({});

        // Define test students with varying progress
        // Note: All students are Web Development until Cybersecurity lessons are added
        const today = new Date();
        const students = [
            // Fully completed students
            {
                id: 'recXYZ123',
                name: 'Alice Johnson',
                weeksActive: 28,
                completionRate: 1.0,
                skipRate: 0.05,
                course: 'Web Development',
                institution: 'V School',
                startDate: '2024-03-15'
            },
            {
                id: 'recABC456',
                name: 'Bob Smith',
                weeksActive: 24,
                completionRate: 1.0,
                skipRate: 0.08,
                course: 'Web Development',
                institution: 'Millersville University',
                startDate: '2024-04-22'
            },

            // High progress students (75-90%)
            {
                id: 'recDEF789',
                name: 'Carol Williams',
                weeksActive: 20,
                completionRate: 0.85,
                skipRate: 0.1,
                course: 'Web Development',
                institution: 'TTU',
                startDate: '2024-05-20'
            },
            {
                id: 'recGHI012',
                name: 'David Brown',
                weeksActive: 18,
                completionRate: 0.78,
                skipRate: 0.12,
                course: 'Web Development',
                institution: 'UVU',
                startDate: '2024-06-03'
            },

            // Mid progress students (40-60%)
            {
                id: 'recJKL345',
                name: 'Emma Davis',
                weeksActive: 14,
                completionRate: 0.55,
                skipRate: 0.15,
                course: 'Web Development',
                institution: 'V School',
                startDate: '2024-07-08'
            },
            {
                id: 'recMNO678',
                name: 'Frank Miller',
                weeksActive: 12,
                completionRate: 0.48,
                skipRate: 0.1,
                course: 'Web Development',
                institution: 'Millersville University',
                startDate: '2024-07-22'
            },
            {
                id: 'recPQR901',
                name: 'Grace Wilson',
                weeksActive: 16,
                completionRate: 0.52,
                skipRate: 0.08,
                course: 'Web Development',
                institution: 'TTU',
                startDate: '2024-06-24'
            },

            // Low progress students (10-30%)
            {
                id: 'recSTU234',
                name: 'Henry Moore',
                weeksActive: 8,
                completionRate: 0.25,
                skipRate: 0.2,
                course: 'Web Development',
                institution: 'UVU',
                startDate: '2024-08-19'
            },
            {
                id: 'recVWX567',
                name: 'Ivy Taylor',
                weeksActive: 6,
                completionRate: 0.18,
                skipRate: 0.15,
                course: 'Web Development',
                institution: 'V School',
                startDate: '2024-09-02'
            },

            // Very new students (just started)
            {
                id: 'recYZA890',
                name: 'Jack Anderson',
                weeksActive: 2,
                completionRate: 0.08,
                skipRate: 0.05,
                course: 'Web Development',
                institution: 'Millersville University',
                startDate: '2024-09-23'
            },
            {
                id: 'recBCD123',
                name: 'Kelly Thomas',
                weeksActive: 3,
                completionRate: 0.12,
                skipRate: 0.1,
                course: 'Web Development',
                institution: 'TTU',
                startDate: '2024-09-16'
            },

            // Inconsistent students (lower activity)
            {
                id: 'recEFG456',
                name: 'Leo Jackson',
                weeksActive: 20,
                completionRate: 0.35,
                skipRate: 0.25,
                course: 'Web Development',
                institution: 'UVU',
                startDate: '2024-05-27'
            },
            {
                id: 'recHIJ789',
                name: 'Mia White',
                weeksActive: 15,
                completionRate: 0.28,
                skipRate: 0.3,
                course: 'Web Development',
                institution: 'V School',
                startDate: '2024-07-01'
            }
        ];

        let allSubmissions = [];

        // Generate submissions for each student
        for (const student of students) {
            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() - student.weeksActive * 7);

            const submissions = generateStudentSubmissions(
                student.id,
                student.name,
                allLessons,
                startDate,
                student.weeksActive,
                student.completionRate,
                student.skipRate
            );

            allSubmissions = allSubmissions.concat(submissions);
        }

        // Insert all submissions
        if (allSubmissions.length > 0) {
            const insertResult =
                await entriesCollection.insertMany(allSubmissions);

            return {
                statusCode: 201,
                headers: { ...getCorsHeaders('POST,OPTIONS'), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Test data seeded successfully',
                    deletedCount: deleteResult.deletedCount,
                    insertedCount: insertResult.insertedCount,
                    students: students.length,
                    summary: students.map((s) => ({
                        name: s.name,
                        submissions: allSubmissions.filter(
                            (sub) => sub.studentId === s.id
                        ).length,
                        weeksActive: s.weeksActive,
                        completionRate: `${(s.completionRate * 100).toFixed(0)}%`
                    }))
                })
            };
        } else {
            return {
                statusCode: 400,
                headers: getCorsHeaders('POST,OPTIONS'),
                body: JSON.stringify({ error: 'No submissions generated' })
            };
        }
    } catch (e) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({ error: 'Server error', details: e.message })
        };
    }
};
