// /.netlify/functions/debug-student-level
// Debug endpoint to investigate why a student's level isn't showing
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
        const q = event.queryStringParameters || {};
        const studentId = q.studentId || '';
        const studentName = q.studentName || '';

        if (!studentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'studentId required' })
            };
        }

        const db = await getDb();
        await createStudentIndexes(db);
        await createLessonEntryIndexes(db);

        const studentsColl = db.collection('students');
        const lessonEntriesColl = db.collection('lesson_entries');
        const lessonsColl = db.collection('lessons');

        // 1. Get student record
        const studentDoc = await studentsColl.findOne({ studentId });

        // 2. Get all lesson entries for this student
        const submissions = await lessonEntriesColl
            .find({ studentId })
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray();

        const submittedLessonIds = submissions.map((s) => s.lessonId);

        // 3. Get the student's course
        const studentCourse = studentDoc?.course || 'Web Development';

        // 4. Get all lessons for this course
        const courseLessons = await lessonsColl
            .find({ courseId: studentCourse })
            .sort({ level: 1, sectionOrder: 1, lessonOrder: 1 })
            .toArray();

        // 5. Find matching lessons
        const matchedLessons = courseLessons.filter((lesson) =>
            submittedLessonIds.includes(lesson.lessonId)
        );

        // 6. Get the highest level
        let currentLevel = null;
        if (matchedLessons.length > 0) {
            currentLevel = Math.max(...matchedLessons.map((l) => l.level || 0));
        }

        // 7. Find unmatched submission lessonIds (those not in the lessons collection)
        const lessonIdsInCollection = new Set(courseLessons.map(l => l.lessonId));
        const unmatchedSubmissions = submittedLessonIds.filter(
            id => !lessonIdsInCollection.has(id)
        );

        // 8. Get sample of lessons to see structure
        const sampleLessons = courseLessons.slice(0, 5).map(l => ({
            lessonId: l.lessonId,
            title: l.title,
            level: l.level,
            courseId: l.courseId
        }));

        const debugInfo = {
            studentId,
            studentName,
            studentRecord: {
                exists: !!studentDoc,
                course: studentDoc?.course || 'N/A',
                institution: studentDoc?.institution || 'N/A'
            },
            submissions: {
                total: submissions.length,
                lessonIds: submittedLessonIds,
                recent: submissions.slice(0, 5).map(s => ({
                    lessonId: s.lessonId,
                    lessonTitle: s.lessonTitle,
                    createdAt: s.createdAt
                }))
            },
            courseLessons: {
                total: courseLessons.length,
                courseId: studentCourse,
                sampleLessons: sampleLessons,
                levelsAvailable: [...new Set(courseLessons.map(l => l.level))].sort()
            },
            matching: {
                matchedCount: matchedLessons.length,
                matchedLessons: matchedLessons.map(l => ({
                    lessonId: l.lessonId,
                    title: l.title,
                    level: l.level
                })),
                unmatchedSubmissions: unmatchedSubmissions,
                unmatchedCount: unmatchedSubmissions.length
            },
            calculatedLevel: currentLevel,
            diagnosis: []
        };

        // Add diagnosis messages
        if (!studentDoc) {
            debugInfo.diagnosis.push('⚠️ Student record not found in students collection');
        }
        if (submissions.length === 0) {
            debugInfo.diagnosis.push('⚠️ No lesson submissions found for this student');
        }
        if (courseLessons.length === 0) {
            debugInfo.diagnosis.push(`⚠️ No lessons found for course: ${studentCourse}`);
        }
        if (matchedLessons.length === 0 && submissions.length > 0 && courseLessons.length > 0) {
            debugInfo.diagnosis.push('🔴 ISSUE FOUND: Student has submissions but none match lessons in the database');
            debugInfo.diagnosis.push(`   - Student submitted ${submittedLessonIds.length} unique lessons`);
            debugInfo.diagnosis.push(`   - But none match the ${courseLessons.length} lessons in the ${studentCourse} course`);
            debugInfo.diagnosis.push('   - Check the "unmatchedSubmissions" list below to see which lessonIds are not in the lessons collection');
        }
        if (matchedLessons.length > 0) {
            debugInfo.diagnosis.push(`✓ Found ${matchedLessons.length} matching lessons`);
            debugInfo.diagnosis.push(`✓ Calculated level: ${currentLevel}`);
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(debugInfo, null, 2)
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
