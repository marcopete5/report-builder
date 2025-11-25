// /.netlify/functions/dashboard-education
// Comprehensive education dashboard data endpoint
const {
    getDb,
    createLessonEntryIndexes,
    createStudentIndexes
} = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { calculatePace } = require('./utils/pace-calculator');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    console.log('=== DASHBOARD START ===');
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS')
        return { statusCode: 204, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'GET')
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    console.log('1. Method check passed');

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        console.log('2. Auth failed');
        return authError;
    }

    console.log('2. Auth passed');

    try {
        const q = event.queryStringParameters || {};
        const courseFilter = q.course || null;
        const institutionFilter = q.institution || null;
        const statusFilter = q.status || null; // current, former

        console.log('3. Query params:', { courseFilter, institutionFilter, statusFilter });

        // Date range for activity (default last 4 weeks)
        const weeksBack = parseInt(q.weeks || '4', 10);
        const activitySince = new Date(Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000);
        const now = new Date();

        console.log('4. Date range calculated:', { weeksBack, activitySince, now });
        console.log('5. Attempting database connection...');

        const db = await getDb();
        console.log('6. Database connected successfully');
        console.log('7. Creating indexes...');
        await createLessonEntryIndexes(db);
        await createStudentIndexes(db);
        console.log('8. Indexes created');

        const studentsColl = db.collection('students');
        const lessonEntriesColl = db.collection('lesson_entries');
        const lessonsColl = db.collection('lessons');
        console.log('9. Collections initialized');

        // Get all students
        let studentsQuery = {};
        console.log('10. Fetching all students...');
        const allStudents = await studentsColl.find(studentsQuery).toArray();
        console.log('11. Students fetched:', allStudents.length);

        // Filter students by course, institution, and status
        let filteredStudents = allStudents.filter(student => {
            let matches = true;

            if (courseFilter) {
                matches = matches && student.course?.toLowerCase().includes(courseFilter.toLowerCase());
            }

            if (institutionFilter) {
                matches = matches && student.institution?.toLowerCase().includes(institutionFilter.toLowerCase());
            }

            if (statusFilter) {
                const today = new Date();
                const endDate = student.courseExtDate || student.courseEndDate;
                if (endDate) {
                    const isCurrent = new Date(endDate) >= today;
                    if (statusFilter === 'current') {
                        matches = matches && isCurrent;
                    } else if (statusFilter === 'former') {
                        matches = matches && !isCurrent;
                    }
                }
            }

            return matches;
        });

        console.log('12. Filtered students:', filteredStudents.length);

        // Get all lessons for pace calculations
        console.log('13. Fetching lessons...');
        const allLessons = await lessonsColl.find({}).toArray();
        console.log('14. Lessons fetched:', allLessons.length);

        const lessonsByCourse = {};
        for (const lesson of allLessons) {
            if (!lessonsByCourse[lesson.courseId]) {
                lessonsByCourse[lesson.courseId] = [];
            }
            lessonsByCourse[lesson.courseId].push(lesson);
        }
        console.log('15. Lessons grouped by course:', Object.keys(lessonsByCourse));

        // Calculate metrics for each student
        console.log('16. Starting student metrics calculation...');
        const studentMetrics = [];
        let processedCount = 0;
        for (const student of filteredStudents) {
            processedCount++;
            if (processedCount % 10 === 0) {
                console.log(`   Processing student ${processedCount}/${filteredStudents.length}`);
            }
            const studentId = student.studentId;

            // Get all submissions for this student
            const submissions = await lessonEntriesColl
                .find({ studentId })
                .toArray();

            const submittedLessonIds = submissions.map(s => s.lessonId);

            // Calculate pace
            let paceStatus = null;
            let paceValue = null;
            const courseLessons = lessonsByCourse[student.course] || [];

            if (student.courseStartDate && student.courseEndDate && courseLessons.length > 0 && submittedLessonIds.length > 0) {
                try {
                    const pace = calculatePace({
                        courseLessons,
                        submittedLessonIds,
                        courseStartDate: student.courseStartDate,
                        courseEndDate: student.courseEndDate
                    });
                    paceStatus = pace.paceStatus; // 'ahead', 'on-pace', 'behind', 'dnf'
                    paceValue = pace.requiredDailyPace;
                } catch (e) {
                    // Continue without pace
                }
            }

            // Calculate attendance (last 4 weeks)
            const recentSubmissions = submissions.filter(s =>
                new Date(s.createdAt) >= activitySince
            );

            const uniqueDays = new Set(
                recentSubmissions.map(s =>
                    new Date(s.createdAt).toISOString().slice(0, 10)
                )
            );

            const daysInPeriod = Math.ceil((now - activitySince) / (1000 * 60 * 60 * 24));
            const attendancePercent = daysInPeriod > 0
                ? (uniqueDays.size / daysInPeriod) * 100
                : 0;

            // Calculate story points per week
            const weeksInPeriod = weeksBack;
            const storyPointsInPeriod = recentSubmissions.reduce((sum, sub) => {
                const lesson = courseLessons.find(l => l.lessonId === sub.lessonId);
                // Ensure we're doing numeric addition, not string concatenation
                const points = Number(lesson?.storyPoints) || 1;
                return sum + points;
            }, 0);
            const storyPointsPerWeek = weeksInPeriod > 0 ? storyPointsInPeriod / weeksInPeriod : 0;

            // Check if started in last 30 days
            const startedRecently = student.courseStartDate &&
                new Date(student.courseStartDate) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            studentMetrics.push({
                studentId,
                studentName: student.studentName,
                course: student.course,
                institution: student.institution,
                paceStatus,
                paceValue,
                attendancePercent,
                attendanceCategory: attendancePercent === 0 ? 'none' :
                                   attendancePercent >= 70 ? 'high' : 'low',
                storyPointsPerWeek,
                startedRecently,
                totalSubmissions: submissions.length,
                recentSubmissions: recentSubmissions.length
            });
        }

        console.log('17. Student metrics calculated, total:', studentMetrics.length);

        // Aggregate metrics
        console.log('18. Starting aggregation...');

        // 1. Course enrollment
        const enrollmentByCourse = {};
        for (const student of filteredStudents) {
            const course = student.course || 'Unknown';
            enrollmentByCourse[course] = (enrollmentByCourse[course] || 0) + 1;
        }

        const totalStudents = filteredStudents.length;
        const courseEnrollment = Object.entries(enrollmentByCourse).map(([course, count]) => ({
            course,
            count,
            percentage: totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0
        }));

        // 2. Institution breakdown
        const enrollmentByInstitution = {};
        for (const student of filteredStudents) {
            const institution = student.institution || 'Unknown';
            enrollmentByInstitution[institution] = (enrollmentByInstitution[institution] || 0) + 1;
        }

        const institutionBreakdown = Object.entries(enrollmentByInstitution).map(([institution, count]) => ({
            institution,
            count,
            percentage: totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0
        }));

        // 3. Pace distribution
        const paceDistribution = {
            ahead: studentMetrics.filter(s => s.paceStatus === 'ahead').length,
            onPace: studentMetrics.filter(s => s.paceStatus === 'on-pace').length,
            behind: studentMetrics.filter(s => s.paceStatus === 'behind' || s.paceStatus === 'dnf').length,
            unknown: studentMetrics.filter(s => !s.paceStatus).length
        };

        // 4. Attendance distribution
        const attendanceDistribution = {
            high: studentMetrics.filter(s => s.attendanceCategory === 'high').length,
            low: studentMetrics.filter(s => s.attendanceCategory === 'low').length,
            none: studentMetrics.filter(s => s.attendanceCategory === 'none').length
        };

        // 5. Average story points per week
        const allStudentsStoryPoints = studentMetrics
            .filter(s => s.storyPointsPerWeek > 0)
            .map(s => s.storyPointsPerWeek);
        const avgStoryPointsAllStudents = allStudentsStoryPoints.length > 0
            ? allStudentsStoryPoints.reduce((a, b) => a + b, 0) / allStudentsStoryPoints.length
            : 0;

        const recentStudentsStoryPoints = studentMetrics
            .filter(s => s.startedRecently && s.storyPointsPerWeek > 0)
            .map(s => s.storyPointsPerWeek);
        const avgStoryPointsRecentStudents = recentStudentsStoryPoints.length > 0
            ? recentStudentsStoryPoints.reduce((a, b) => a + b, 0) / recentStudentsStoryPoints.length
            : 0;

        // 6. Student lists by pace
        const studentsByPace = {
            ahead: studentMetrics.filter(s => s.paceStatus === 'ahead')
                .sort((a, b) => b.storyPointsPerWeek - a.storyPointsPerWeek)
                .slice(0, 50), // Top 50
            onPace: studentMetrics.filter(s => s.paceStatus === 'on-pace')
                .sort((a, b) => b.storyPointsPerWeek - a.storyPointsPerWeek)
                .slice(0, 50),
            behind: studentMetrics.filter(s => s.paceStatus === 'behind' || s.paceStatus === 'dnf')
                .sort((a, b) => a.storyPointsPerWeek - b.storyPointsPerWeek)
                .slice(0, 50)
        };

        console.log('19. Aggregation complete, preparing response...');

        const responseData = {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                summary: {
                    totalStudents,
                    dateRange: {
                        from: activitySince.toISOString(),
                        to: now.toISOString(),
                        weeks: weeksBack
                    }
                },
                courseEnrollment,
                institutionBreakdown,
                paceDistribution,
                attendanceDistribution,
                averageStoryPoints: {
                    allStudents: parseFloat(avgStoryPointsAllStudents.toFixed(2)),
                    recentStudents: parseFloat(avgStoryPointsRecentStudents.toFixed(2))
                },
                studentsByPace,
                filters: {
                    course: courseFilter,
                    institution: institutionFilter,
                    status: statusFilter
                }
            })
        };

        console.log('20. Response prepared successfully');
        console.log('=== DASHBOARD END (SUCCESS) ===');
        return responseData;
    } catch (e) {
        console.error('=== DASHBOARD ERROR ===');
        console.error('Error type:', e.constructor.name);
        console.error('Error message:', e.message);
        console.error('Stack trace:', e.stack);
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
