// /.netlify/functions/my-report
// Student-specific report endpoint
// Students see only their own data, admins can view any student

const { getDb, createLessonEntryIndexes, createStudentIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireStudent, getUserFromEvent, isAdmin, getAuthorizedStudentId } = require('./utils/db-auth');
const { getMockStudentData } = require('./utils/mock-data');
const { calculatePace } = require('./utils/pace-calculator');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Require student or admin authentication
    const authError = requireStudent(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const user = getUserFromEvent(event);
        const studentId = getAuthorizedStudentId(event, user);

        if (!studentId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'No student ID available',
                    message: 'Students: Your account is not linked to a student record. Contact admin.',
                    isAdmin: isAdmin(user)
                })
            };
        }

        const db = await getDb();
        await createLessonEntryIndexes(db);
        await createStudentIndexes(db);

        const coll = db.collection('lesson_entries');
        const studentsColl = db.collection('students');
        const lessonsCollection = db.collection('lessons');

        // Get student info
        const student = await studentsColl.findOne({ studentId });

        if (!student) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Student not found',
                    studentId
                })
            };
        }

        // Get date range from query params (default to last 30 days)
        const q = event.queryStringParameters || {};
        const days = q.days === 'all' ? 'all' : Math.max(1, Math.min(365, parseInt(q.days || '30', 10)));

        let since, until;
        if (days === 'all') {
            since = new Date('2000-01-01');
            until = new Date();
        } else {
            since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            until = new Date();
        }

        // Get ALL submissions for this student (for current location and progress)
        const allSubmissions = await coll.find({ studentId }).sort({ createdAt: -1 }).toArray();

        // Get submissions in selected range
        const rangeSubmissions = allSubmissions.filter(
            s => s.createdAt >= since && s.createdAt <= until
        );

        // Calculate stats
        const totalSubmissions = allSubmissions.length;
        const rangeSubmissionCount = rangeSubmissions.length;

        // Get unique days with submissions in range
        const daysWithSubmissions = new Set(
            rangeSubmissions.map(s => s.createdAt.toISOString().split('T')[0])
        ).size;

        // Get last submission
        const lastSubmission = allSubmissions.length > 0 ? {
            lessonId: allSubmissions[0].lessonId,
            lessonTitle: allSubmissions[0].lessonTitle,
            submittedAt: allSubmissions[0].createdAt
        } : null;

        // Group by lesson
        const lessonMap = new Map();
        rangeSubmissions.forEach(sub => {
            if (!lessonMap.has(sub.lessonId)) {
                lessonMap.set(sub.lessonId, {
                    lessonId: sub.lessonId,
                    lessonTitle: sub.lessonTitle,
                    count: 0,
                    lastSubmitted: sub.createdAt
                });
            }
            const lesson = lessonMap.get(sub.lessonId);
            lesson.count++;
            if (sub.createdAt > lesson.lastSubmitted) {
                lesson.lastSubmitted = sub.createdAt;
            }
        });

        const lessonBreakdown = Array.from(lessonMap.values()).sort(
            (a, b) => b.lastSubmitted - a.lastSubmitted
        );

        // Calculate daily submissions for chart
        const dailyMap = new Map();
        rangeSubmissions.forEach(sub => {
            const day = sub.createdAt.toISOString().split('T')[0];
            dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
        });

        const dailySeries = [];
        for (let d = new Date(since); d <= until; d.setDate(d.getDate() + 1)) {
            const dayStr = d.toISOString().split('T')[0];
            dailySeries.push({
                date: dayStr,
                count: dailyMap.get(dayStr) || 0
            });
        }

        // Calculate daily story points for chart (will be added after we load lessons)

        // Fetch student metadata (mentor, dates, etc.)
        let airtableData = {};
        const mockData = getMockStudentData(studentId);

        if (mockData) {
            airtableData = {
                startDate: mockData.startDate,
                endDate: mockData.endDate,
                enrolledCourse: mockData.course,
                enrollingInstitution: mockData.institution,
                mentorName: mockData.mentor
            };
        } else {
            airtableData = {
                startDate: student.courseStartDate,
                endDate: student.courseEndDate,
                enrolledCourse: student.course,
                enrollingInstitution: student.institution,
                mentorName: null
            };

            // Fetch mentor name from Airtable if we have a mentorId
            if (student.mentorId) {
                try {
                    const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
                    if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
                        const mentorUrl = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/tbltF8lKcWspt0KHR/${encodeURIComponent(student.mentorId)}`;
                        const mentorRes = await fetch(mentorUrl, {
                            headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
                        });
                        if (mentorRes.ok) {
                            const mentorRecord = await mentorRes.json();
                            const mentorFields = mentorRecord.fields || {};
                            const firstName = mentorFields['First Name'] || '';
                            const lastName = mentorFields['Last Name'] || '';
                            airtableData.mentorName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
                        }
                    }
                } catch (mentorErr) {
                    // Ignore mentor fetch errors
                }
            }
        }

        // Fetch all lessons for the enrolled course
        const enrolledCourse = airtableData.enrolledCourse || student.course || 'Web Development';
        const allLessons = await lessonsCollection.find({ courseId: enrolledCourse })
            .sort({ level: 1, sectionOrder: 1, lessonOrder: 1 })
            .toArray();

        // Create lesson lookup map for story points
        const lessonStoryPointsMap = new Map();
        allLessons.forEach(lesson => {
            lessonStoryPointsMap.set(lesson.lessonId, Number(lesson.storyPoints || 0));
        });

        // Calculate story points per day
        const dailyStoryPointsMap = new Map();
        rangeSubmissions.forEach(sub => {
            const day = sub.createdAt.toISOString().split('T')[0];
            const points = lessonStoryPointsMap.get(sub.lessonId) || 0;
            dailyStoryPointsMap.set(day, (dailyStoryPointsMap.get(day) || 0) + points);
        });

        // Add story points to daily series
        dailySeries.forEach(dayData => {
            dayData.storyPoints = dailyStoryPointsMap.get(dayData.date) || 0;
        });

        // Calculate total story points
        const totalCoursePoints = allLessons.reduce((sum, l) => sum + Number(l.storyPoints || 0), 0);

        const pointsByLevel = {};
        const pointsBySection = {};
        allLessons.forEach((lesson) => {
            const level = lesson.level;
            const section = `L${level}-${lesson.section}`;
            if (!pointsByLevel[level]) pointsByLevel[level] = 0;
            if (!pointsBySection[section]) pointsBySection[section] = 0;
            pointsByLevel[level] += Number(lesson.storyPoints || 0);
            pointsBySection[section] += Number(lesson.storyPoints || 0);
        });

        // Get unique submitted lesson IDs
        const submittedLessonIds = new Set(allSubmissions.map((s) => s.lessonId).filter(Boolean));

        // Find current lesson (last submitted)
        const currentLesson = allSubmissions.length > 0 ? allSubmissions[0] : null;

        // Find furthest lesson reached
        let furthestLesson = null;
        let furthestLessonData = null;

        if (allSubmissions.length > 0) {
            for (const submission of allSubmissions) {
                const lessonData = allLessons.find((l) => l.lessonId === submission.lessonId);
                if (lessonData) {
                    if (!furthestLessonData) {
                        furthestLessonData = lessonData;
                        furthestLesson = submission;
                    } else {
                        if (
                            lessonData.level > furthestLessonData.level ||
                            (lessonData.level === furthestLessonData.level &&
                                lessonData.sectionOrder > furthestLessonData.sectionOrder) ||
                            (lessonData.level === furthestLessonData.level &&
                                lessonData.sectionOrder === furthestLessonData.sectionOrder &&
                                lessonData.lessonOrder > furthestLessonData.lessonOrder)
                        ) {
                            furthestLessonData = lessonData;
                            furthestLesson = submission;
                        }
                    }
                }
            }
        }

        // Calculate completed story points (including skipped lessons)
        let completedPoints = 0;
        const completedByLevel = {};
        const completedBySection = {};

        allLessons.forEach((lesson) => {
            const level = lesson.level;
            const section = `L${level}-${lesson.section}`;

            const isSubmitted = submittedLessonIds.has(lesson.lessonId);
            const isSkipped = furthestLessonData && (
                lesson.level < furthestLessonData.level ||
                (lesson.level === furthestLessonData.level && lesson.sectionOrder < furthestLessonData.sectionOrder) ||
                (lesson.level === furthestLessonData.level && lesson.sectionOrder === furthestLessonData.sectionOrder && lesson.lessonOrder < furthestLessonData.lessonOrder)
            );

            if (isSubmitted || isSkipped) {
                const points = Number(lesson.storyPoints || 0);
                completedPoints += points;
                if (!completedByLevel[level]) completedByLevel[level] = 0;
                if (!completedBySection[section]) completedBySection[section] = 0;
                completedByLevel[level] += points;
                completedBySection[section] += points;
            }
        });

        // Calculate story points in selected date range
        const rangeSubmittedLessonIds = new Set(rangeSubmissions.map((s) => s.lessonId).filter(Boolean));
        let rangePoints = 0;
        allLessons.forEach((lesson) => {
            if (rangeSubmittedLessonIds.has(lesson.lessonId)) {
                rangePoints += Number(lesson.storyPoints || 0);
            }
        });

        // Calculate percentages for current location
        const currentLessonData = currentLesson ? allLessons.find((l) => l.lessonId === currentLesson.lessonId) : null;
        let sectionProgress = 0, levelProgress = 0, courseProgress = 0;

        if (currentLessonData) {
            const currentSection = `L${currentLessonData.level}-${currentLessonData.section}`;
            const currentLevel = currentLessonData.level;
            sectionProgress = pointsBySection[currentSection] > 0
                ? ((completedBySection[currentSection] || 0) / pointsBySection[currentSection]) * 100
                : 0;
            levelProgress = pointsByLevel[currentLevel] > 0
                ? ((completedByLevel[currentLevel] || 0) / pointsByLevel[currentLevel]) * 100
                : 0;
        }

        courseProgress = totalCoursePoints > 0 ? (completedPoints / totalCoursePoints) * 100 : 0;

        // Calculate attendance statistics
        const allDaysWithSubmissions = new Set();
        allSubmissions.forEach((sub) => {
            const dateStr = new Date(sub.createdAt).toISOString().slice(0, 10);
            allDaysWithSubmissions.add(dateStr);
        });

        const firstSubmissionDate = allSubmissions.length > 0
            ? new Date(allSubmissions[allSubmissions.length - 1].createdAt)
            : new Date();
        const daysSinceStart = Math.max(1, Math.ceil((new Date() - firstSubmissionDate) / (1000 * 60 * 60 * 24)));
        const allTimeAttendancePercent = (allDaysWithSubmissions.size / daysSinceStart) * 100;

        // Last 7 days attendance
        let last7DaysAttended = 0;
        for (let i = 0; i < 7; i++) {
            const checkDate = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const dateStr = checkDate.toISOString().slice(0, 10);
            if (allDaysWithSubmissions.has(dateStr)) {
                last7DaysAttended++;
            }
        }

        // Calculate streaks and largest gap
        const allDates = Array.from(allDaysWithSubmissions).sort();
        let longestStreak = 0, currentStreak = 0, largestGap = 0;
        let tempStreak = 1;

        for (let i = 1; i < allDates.length; i++) {
            const prevDate = new Date(allDates[i - 1]);
            const currDate = new Date(allDates[i]);
            const dayDiff = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));

            if (dayDiff === 1) {
                tempStreak++;
            } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 1;
                largestGap = Math.max(largestGap, dayDiff - 1);
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        // Calculate current active streak
        const today = new Date().toISOString().slice(0, 10);
        let checkDate = new Date();
        while (true) {
            const dateStr = checkDate.toISOString().slice(0, 10);
            if (allDaysWithSubmissions.has(dateStr)) {
                currentStreak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else if (dateStr === today) {
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        // Average days attended per week
        const weeksSinceStart = Math.max(1, daysSinceStart / 7);
        const avgDaysPerWeek = allDaysWithSubmissions.size / weeksSinceStart;

        // Calculate pace if we have start/end dates
        let paceData = null;
        let estimatedEndDate = null;
        let daysLate = 0;
        const courseStartDate = mockData?.startDate || airtableData?.startDate;
        const courseEndDate = mockData?.endDate || airtableData?.endDate;

        if (courseStartDate && courseEndDate) {
            const submittedIds = allSubmissions.map(s => s.lessonId);
            paceData = calculatePace({
                courseLessons: allLessons,
                submittedLessonIds: submittedIds,
                courseStartDate: courseStartDate,
                courseEndDate: courseEndDate
            });

            if (paceData.actualDailyPace > 0 && paceData.remainingStoryPoints > 0) {
                const daysNeeded = Math.ceil(paceData.remainingStoryPoints / paceData.actualDailyPace);
                const todayDate = new Date();
                estimatedEndDate = new Date(todayDate.getTime() + daysNeeded * 24 * 60 * 60 * 1000);

                // Calculate days late (positive means late, negative means early)
                const courseEndDateObj = new Date(courseEndDate);
                const diffTime = estimatedEndDate - courseEndDateObj;
                daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            } else if (paceData.isPastEndDate || paceData.remainingStoryPoints === 0) {
                estimatedEndDate = 'Complete';
                daysLate = 0; // Already complete, so not late
            } else {
                estimatedEndDate = 'N/A';
                daysLate = 0;
            }
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student: {
                    studentId: student.studentId,
                    studentName: student.studentName,
                    course: airtableData.enrolledCourse || student.course,
                    institution: airtableData.enrollingInstitution || student.institution,
                    courseStartDate: airtableData.startDate || student.courseStartDate,
                    courseEndDate: airtableData.endDate || student.courseEndDate,
                    mentorName: airtableData.mentorName,
                    estimatedEndDate: estimatedEndDate,
                    daysLate: daysLate
                },
                stats: {
                    totalSubmissions,
                    rangeSubmissions: rangeSubmissionCount,
                    activeDaysInRange: daysWithSubmissions,
                    dateRange: {
                        since: since.toISOString(),
                        until: until.toISOString(),
                        days: days
                    }
                },
                lastSubmission,
                lessonBreakdown,
                dailySeries,
                currentLocation: {
                    currentLesson: currentLessonData ? {
                        lessonId: currentLessonData.lessonId,
                        title: currentLessonData.title,
                        level: currentLessonData.level,
                        section: currentLessonData.section
                    } : null,
                    furthestLesson: furthestLessonData ? {
                        lessonId: furthestLessonData.lessonId,
                        title: furthestLessonData.title,
                        level: furthestLessonData.level,
                        section: furthestLessonData.section
                    } : null
                },
                progress: {
                    sectionProgress: sectionProgress,
                    levelProgress: levelProgress,
                    courseProgress: courseProgress,
                    completedStoryPoints: completedPoints,
                    totalCoursePoints: totalCoursePoints,
                    rangeStoryPoints: rangePoints
                },
                attendance: {
                    allTimeAttendancePercent: allTimeAttendancePercent,
                    last7DaysAttended: last7DaysAttended,
                    avgDaysPerWeek: avgDaysPerWeek,
                    currentStreak: currentStreak,
                    longestStreak: longestStreak,
                    largestGap: largestGap,
                    totalActiveDays: allDaysWithSubmissions.size
                },
                pace: paceData,
                viewedBy: {
                    userId: user.id,
                    email: user.email,
                    isAdmin: isAdmin(user)
                }
            })
        };
    } catch (err) {
        console.error('Error in my-report:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
