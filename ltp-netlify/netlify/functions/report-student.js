// /.netlify/functions/report-student
// Returns per-day counts for a student over the last N days.
// Query: ?studentId=...&days=7&format=json (json only; used by the weekly UI)
const { getDb, createStudentIndexes } = require('./utils/database');
const { getMockStudentData } = require('./utils/mock-data');
const { getCorsHeaders } = require('./utils/cors');
const { calculatePace } = require('./utils/pace-calculator');
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

    try{
        const q = event.queryStringParameters || {};
        const studentId = q.studentId || '';
        const daysParam = q.days || '7';
        let days;

        if (daysParam === 'all') {
            days = 'all';
        } else {
            days = Math.max(1, parseInt(daysParam, 10));
        }

        if (!studentId) {
            return {
                statusCode: 400,
                headers: getCorsHeaders('GET,OPTIONS'),
                body: JSON.stringify({ error: 'studentId required' })
            };
        }

        // Support custom date range
        let since, until, isCustomRange = false;
        const startDate = q.startDate;
        const endDate = q.endDate;

        if (startDate && endDate) {
            since = new Date(startDate);
            until = new Date(endDate);
            until.setHours(23, 59, 59, 999);
            isCustomRange = true;
        } else if (days === 'all') {
            since = new Date('2000-01-01');
            until = new Date();
        } else {
            since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            until = new Date();
        }

        const db = await getDb();

        // Create indexes for students collection
        await createStudentIndexes(db);

        const coll = db.collection('lesson_entries');

        const pipeline = [
            { $match: { studentId, createdAt: { $gte: since, $lte: until } } },
            {
                $addFields: {
                    _day: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt'
                        }
                    }
                }
            },
            { $group: { _id: '$_day', count: { $sum: 1 } } },
            { $project: { _id: 0, date: '$_id', count: 1 } },
            { $sort: { date: 1 } }
        ];
        const agg = await coll.aggregate(pipeline).toArray();

        // Fill missing days with 0 to make charts cleaner
        const byDate = new Map(agg.map((d) => [d.date, d.count]));
        const dayMs = 24 * 60 * 60 * 1000;
        const series = [];

        // Always fill all days in the range for consistent charting
        const startDay = new Date(since);
        startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(until);
        endDay.setHours(0, 0, 0, 0);

        for (let d = new Date(startDay); d <= endDay; d.setDate(d.getDate() + 1)) {
            const iso = d.toISOString().slice(0, 10);
            series.push({ date: iso, count: byDate.get(iso) || 0 });
        }

        const totalActiveDays = series.filter((d) => d.count > 0).length;
        const totalEntries = series.reduce((s, d) => s + d.count, 0);

        // Fetch all-time totals
        const allTimeTotal = await coll.countDocuments({ studentId });

        // For custom range, show stats for the selected range
        // Otherwise show last 7 days
        let rangeTotal, rangeLabel;
        if (isCustomRange) {
            rangeTotal = totalEntries;
            rangeLabel = `${startDate} to ${endDate}`;
        } else {
            const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            rangeTotal = await coll.countDocuments({
                studentId,
                createdAt: { $gte: last7Days }
            });
            rangeLabel = 'last 7 days';
        }

        // Get last submission details
        const lastSubmission = await coll
            .find({ studentId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();

        // Get all unique lessonIds submitted by this student
        const submittedLessons = await coll.distinct('lessonId', { studentId });

        // Fetch student details: try MongoDB first, then Airtable, then mock data
        let airtableData = {};

        // Check if we should use mock data (for test students)
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
            // Try MongoDB students collection first
            let foundInMongoDB = false;
            try {
                const studentDoc = await db.collection('students').findOne({ studentId });

                if (studentDoc) {
                    foundInMongoDB = true;

                    // Map MongoDB fields to airtableData structure
                    airtableData = {
                        startDate: studentDoc.courseStartDate || null,
                        endDate: studentDoc.courseEndDate || null,
                        enrolledCourse: studentDoc.course || null,
                        enrollingInstitution: studentDoc.institution || null,
                        mentorName: studentDoc.mentorName || null
                    };

                    // If we have mentorId but no mentorName, fetch from Airtable
                    if (studentDoc.mentorId && !studentDoc.mentorName) {
                        try {
                            const {
                                AIRTABLE_API_KEY,
                                AIRTABLE_BASE_ID
                            } = process.env;

                            if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
                                const mentorUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                                    AIRTABLE_BASE_ID
                                )}/tbltF8lKcWspt0KHR/${encodeURIComponent(studentDoc.mentorId)}`;

                                const mentorRes = await fetch(mentorUrl, {
                                    headers: {
                                        Authorization: `Bearer ${AIRTABLE_API_KEY}`
                                    }
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
                            // Continue without mentor name
                        }
                    }
                }
            } catch (mongoErr) {
                // Continue to try Airtable
            }

            // Fall back to Airtable if not found in MongoDB
            if (!foundInMongoDB) {
                try {
                    const {
                        AIRTABLE_API_KEY,
                        AIRTABLE_BASE_ID,
                        AIRTABLE_TABLE = 'Students'
                    } = process.env;

                    if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
                    const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                        AIRTABLE_BASE_ID
                    )}/${encodeURIComponent(AIRTABLE_TABLE)}/${encodeURIComponent(
                        studentId
                    )}`;

                    const airtableRes = await fetch(airtableUrl, {
                        headers: {
                            Authorization: `Bearer ${AIRTABLE_API_KEY}`
                        }
                    });

                    if (airtableRes.ok) {
                        const record = await airtableRes.json();

                        const fields = record.fields || {};

                        // Fetch mentor details if Mentor Assigned exists
                        let mentorName = null;
                        const mentorId = Array.isArray(fields['Mentor Assigned'])
                            ? fields['Mentor Assigned'][0]
                            : fields['Mentor Assigned'];

                        if (mentorId) {
                            try {
                                const mentorUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                                    AIRTABLE_BASE_ID
                                )}/tbltF8lKcWspt0KHR/${encodeURIComponent(mentorId)}`;

                                const mentorRes = await fetch(mentorUrl, {
                                    headers: {
                                        Authorization: `Bearer ${AIRTABLE_API_KEY}`
                                    }
                                });

                                if (mentorRes.ok) {
                                    const mentorRecord = await mentorRes.json();

                                    const mentorFields = mentorRecord.fields || {};
                                    const firstName = mentorFields['First Name'] || '';
                                    const lastName = mentorFields['Last Name'] || '';
                                    mentorName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

                                } else {
                                    const mentorError = await mentorRes.text();
                                }
                            } catch (mentorErr) {
                            }
                        }

                        airtableData = {
                            startDate: fields['Course Start Date'],
                            endDate: fields['Course End Date'],
                            enrolledCourse: fields['Course Subject'],
                            enrollingInstitution: fields['Enrolling Institution'],
                            mentorName: mentorName
                        };
                    } else {
                        const errorText = await airtableRes.text();
                    }
                    } else {
                    }
                } catch (err) {
                    // Continue without Airtable data
                }
            }
        }

        // Calculate current location data
        let currentLocationData = null;
        const courseId = airtableData.enrolledCourse || 'Web Development';

        if (courseId) {
            try {
                const lessonsCollection = db.collection('lessons');
                const allLessons = await lessonsCollection
                    .find({ courseId })
                    .sort({ level: 1, sectionOrder: 1, lessonOrder: 1 })
                    .toArray();

                if (allLessons.length > 0 && lastSubmission[0]) {
                    // Find current lesson (most recent submission)
                    const currentLessonData = allLessons.find(
                        l => l.lessonId === lastSubmission[0].lessonId
                    );

                    // Find furthest lesson reached
                    let furthestLessonData = null;
                    for (const lessonId of submittedLessons) {
                        const lessonData = allLessons.find(l => l.lessonId === lessonId);
                        if (lessonData) {
                            if (!furthestLessonData) {
                                furthestLessonData = lessonData;
                            } else {
                                // Compare levels, sections, then lesson order
                                if (
                                    lessonData.level > furthestLessonData.level ||
                                    (lessonData.level === furthestLessonData.level &&
                                        lessonData.sectionOrder > furthestLessonData.sectionOrder) ||
                                    (lessonData.level === furthestLessonData.level &&
                                        lessonData.sectionOrder === furthestLessonData.sectionOrder &&
                                        lessonData.lessonOrder > furthestLessonData.lessonOrder)
                                ) {
                                    furthestLessonData = lessonData;
                                }
                            }
                        }
                    }

                    currentLocationData = {
                        currentLesson: currentLessonData?.title || null,
                        currentLevel: currentLessonData?.level || null,
                        currentSection: currentLessonData?.section || null,
                        furthestProgress: furthestLessonData?.lessonId || null
                    };
                }
            } catch (err) {
            }
        }

        // Calculate pace metrics using shared utility
        let paceData = null;
        const startDateStr = airtableData.startDate;
        const endDateStr = airtableData.endDate;

        if (courseId && startDateStr && endDateStr && submittedLessons.length > 0) {
            try {
                const lessonsCollection = db.collection('lessons');

                // Get all lessons for this course
                const courseLessons = await lessonsCollection
                    .find({ courseId })
                    .toArray();

                if (courseLessons.length > 0) {
                    // Use the shared pace calculator utility
                    const pace = calculatePace({
                        courseLessons,
                        submittedLessonIds: submittedLessons,
                        courseStartDate: startDateStr,
                        courseEndDate: endDateStr
                    });

                    // Calculate estimated completion date based on actual pace
                    let estimatedCompletionDate = null;
                    if (pace.isPastEndDate && pace.completedStoryPoints < pace.totalStoryPoints) {
                        estimatedCompletionDate = 'DNF';
                    } else if (pace.actualDailyPace > 0 && pace.remainingStoryPoints > 0) {
                        const daysToComplete = Math.ceil(pace.remainingStoryPoints / pace.actualDailyPace);
                        const today = new Date();
                        const estDate = new Date(today.getTime() + (daysToComplete * 24 * 60 * 60 * 1000));
                        // Validate the date is reasonable
                        if (!isNaN(estDate.getTime()) && estDate.getFullYear() < 2100) {
                            estimatedCompletionDate = estDate;
                        }
                    }

                    // Calculate pace percentage for display
                    const courseStartDate = new Date(startDateStr);
                    const courseEndDate = new Date(endDateStr);
                    const today = new Date();
                    const totalCourseDays = Math.ceil((courseEndDate - courseStartDate) / (1000 * 60 * 60 * 24));
                    const daysElapsed = Math.ceil((today - courseStartDate) / (1000 * 60 * 60 * 24));
                    const originalRequiredPace = totalCourseDays > 0 ? pace.totalStoryPoints / totalCourseDays : 0;
                    const expectedStoryPoints = originalRequiredPace * daysElapsed;
                    const pacePercentage = expectedStoryPoints > 0
                        ? Math.round(((pace.completedStoryPoints - expectedStoryPoints) / expectedStoryPoints) * 100)
                        : 0;

                    paceData = {
                        totalStoryPoints: pace.totalStoryPoints,
                        completedStoryPoints: pace.completedStoryPoints,
                        remainingStoryPoints: pace.remainingStoryPoints,
                        progressPercentage: pace.totalStoryPoints > 0
                            ? Math.round((pace.completedStoryPoints / pace.totalStoryPoints) * 100)
                            : 0,
                        totalCourseDays,
                        daysElapsed,
                        daysRemaining: pace.daysRemaining,
                        requiredDailyPace: pace.requiredDailyPace,
                        actualDailyPace: pace.actualDailyPace,
                        paceStatus: pace.paceStatus,
                        pacePercentage,
                        estimatedCompletionDate: estimatedCompletionDate === 'DNF'
                            ? 'DNF'
                            : (estimatedCompletionDate ? estimatedCompletionDate.toISOString() : null),
                        onTrack: pace.paceStatus !== 'behind',
                        isPastEndDate: pace.isPastEndDate
                    };

                }
            } catch (err) {
                // Continue without pace data
            }
        }

        // Calculate attendance based on course start and end dates
        let courseAttendance = null;
        if (airtableData.startDate && airtableData.endDate) {
            const courseStart = new Date(airtableData.startDate);
            const courseEnd = new Date(airtableData.endDate);
            const today = new Date();

            // Use the earlier of today or course end date
            const effectiveEnd = today < courseEnd ? today : courseEnd;

            // Calculate total course days from start to effective end
            const totalCourseDays = Math.ceil((effectiveEnd - courseStart) / (1000 * 60 * 60 * 24)) + 1;

            // Get all submissions within the course date range
            const courseRangeSubmissions = await coll
                .find({
                    studentId,
                    createdAt: { $gte: courseStart, $lte: courseEnd }
                })
                .toArray();

            // Count unique days with submissions
            const uniqueDays = new Set(
                courseRangeSubmissions.map(sub =>
                    new Date(sub.createdAt).toISOString().slice(0, 10)
                )
            );
            const daysWithSubmissions = uniqueDays.size;

            // Calculate attendance percentage
            const attendancePercent = totalCourseDays > 0
                ? ((daysWithSubmissions / totalCourseDays) * 100).toFixed(1)
                : 0;

            courseAttendance = {
                daysWithSubmissions,
                totalCourseDays,
                attendancePercent
            };
        }

        return {
            statusCode: 200,
            headers: { ...getCorsHeaders('GET,OPTIONS'), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                days,
                series,
                totalActiveDays,
                totalEntries,
                totals: {
                    totalSubmissions: allTimeTotal,
                    rangeSubmissions: rangeTotal,
                    rangeLabel: rangeLabel
                },
                lastSubmission: lastSubmission[0]
                    ? {
                          at: lastSubmission[0].createdAt,
                          lessonId: lastSubmission[0].lessonId,
                          lessonTitle: lastSubmission[0].lessonTitle
                      }
                    : null,
                startDate: airtableData.startDate || null,
                endDate: airtableData.endDate || null,
                enrolledCourse: airtableData.enrolledCourse || null,
                enrollingInstitution: airtableData.enrollingInstitution || null,
                mentorName: airtableData.mentorName || null,
                currentLocation: currentLocationData,
                pace: paceData,
                courseAttendance: courseAttendance
            })
        };
    } catch (e) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Server error' })
        };
    }
};
