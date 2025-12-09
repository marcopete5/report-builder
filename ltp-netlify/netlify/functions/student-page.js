// /.netlify/functions/student-page
// Full-page student detail view with comprehensive information

const { getDb, createStudentIndexes } = require('./utils/database');
const { getMockStudentData } = require('./utils/mock-data');
const { getCorsHeaders } = require('./utils/cors');
const { calculatePace } = require('./utils/pace-calculator');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS')
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
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
        const studentName = q.studentName || 'Student';
        const daysParam = q.days || 'fullPeriod';
        const startDate = q.startDate;
        const endDate = q.endDate;

        if (!studentId) {
            return {
                statusCode: 400,
                headers: getCorsHeaders('GET,OPTIONS'),
                body: JSON.stringify({ error: 'studentId required' })
            };
        }

        const days =
            daysParam === 'all' || daysParam === 'fullPeriod'
                ? daysParam
                : Math.max(1, Math.min(365, parseInt(daysParam, 10)));

        // Determine date range
        let since,
            until,
            isCustomRange = false,
            isFullPeriod = false;
        if (startDate && endDate) {
            since = new Date(startDate);
            until = new Date(endDate);
            until.setHours(23, 59, 59, 999);
            isCustomRange = true;
        } else if (days === 'all') {
            since = new Date('2000-01-01');
            until = new Date();
        } else if (days === 'fullPeriod') {
            // Full Period - will use student's course start date
            isFullPeriod = true;
            since = null; // Will be set later based on student data
            until = new Date();
        } else {
            since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            until = new Date();
        }

        const db = await getDb();
        await createStudentIndexes(db);
        const coll = db.collection('lesson_entries');
        const lessonsCollection = db.collection('lessons');

        // Get ALL submissions for this student (for current location and progress)
        const allSubmissions = await coll
            .find({ studentId })
            .sort({ createdAt: -1 })
            .toArray();

        // For fullPeriod mode, get student's course start date first
        if (isFullPeriod) {
            const studentDoc = await db.collection('students').findOne({ studentId });
            if (studentDoc && studentDoc.courseStartDate) {
                since = new Date(studentDoc.courseStartDate);
            } else {
                // Fallback to first submission date if no course start date
                if (allSubmissions.length > 0) {
                    since = new Date(allSubmissions[allSubmissions.length - 1].createdAt);
                } else {
                    since = new Date('2000-01-01');
                }
            }
        }

        // Get submissions in date range (for display)
        const submissions = await coll
            .find({ studentId, createdAt: { $gte: since, $lte: until } })
            .sort({ createdAt: -1 })
            .toArray();

        // Aggregate by day
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

        // Fill missing days
        const byDate = new Map(agg.map((d) => [d.date, d.count]));
        const series = [];
        const startDay = new Date(since);
        startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(until);
        endDay.setHours(0, 0, 0, 0);

        for (
            let d = new Date(startDay);
            d <= endDay;
            d.setDate(d.getDate() + 1)
        ) {
            const iso = d.toISOString().slice(0, 10);
            series.push({ date: iso, count: byDate.get(iso) || 0 });
        }

        const totalActiveDays = series.filter((d) => d.count > 0).length;
        const totalEntries = series.reduce((s, d) => s + d.count, 0);

        // Get all-time totals
        const allTimeTotal = await coll.countDocuments({ studentId });

        // Range stats
        let rangeTotal, rangeLabel;
        if (isCustomRange) {
            rangeTotal = totalEntries;
            rangeLabel = `${startDate} to ${endDate}`;
        } else if (isFullPeriod) {
            rangeTotal = totalEntries;
            rangeLabel = 'Full Enrollment Period';
        } else if (days === 'all') {
            rangeTotal = totalEntries;
            rangeLabel = 'All Time';
        } else {
            rangeTotal = totalEntries;
            rangeLabel = `last ${days} days`;
        }

        // Last submission
        const lastSubmission = await coll
            .find({ studentId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();

        // Fetch student data: try MongoDB first, then mock data, then Airtable
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
            // Try MongoDB first
            try {
                const studentDoc = await db.collection('students').findOne({ studentId });

                if (studentDoc) {
                    // Found in MongoDB - use that data
                    airtableData = {
                        startDate: studentDoc.courseStartDate,
                        endDate: studentDoc.courseEndDate,
                        enrolledCourse: studentDoc.course,
                        enrollingInstitution: studentDoc.institution,
                        mentorName: null, // We'll fetch mentor name from Airtable if mentorId exists
                        profilePictureUrl: studentDoc.profilePictureUrl || null
                    };

                    // Fetch mentor name from Airtable if we have a mentorId
                    if (studentDoc.mentorId) {
                        try {
                            const {
                                AIRTABLE_API_KEY,
                                AIRTABLE_BASE_ID
                            } = process.env;

                            if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
                                const mentorUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                                    AIRTABLE_BASE_ID
                                )}/tbltF8lKcWspt0KHR/${encodeURIComponent(
                                    studentDoc.mentorId
                                )}`;

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
                                    airtableData.mentorName =
                                        [firstName, lastName]
                                            .filter(Boolean)
                                            .join(' ')
                                            .trim() || null;
                                }
                            }
                        } catch (mentorErr) {
                        }
                    }
                } else {
                    // Not found in MongoDB - fall back to Airtable
                    try {
                        const {
                            AIRTABLE_API_KEY,
                            AIRTABLE_BASE_ID,
                            AIRTABLE_TABLE = 'Students'
                        } = process.env;

                        if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
                            const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                                AIRTABLE_BASE_ID
                            )}/${encodeURIComponent(
                                AIRTABLE_TABLE
                            )}/${encodeURIComponent(studentId)}`;

                            const airtableRes = await fetch(airtableUrl, {
                                headers: {
                                    Authorization: `Bearer ${AIRTABLE_API_KEY}`
                                }
                            });

                            if (airtableRes.ok) {
                                const record = await airtableRes.json();
                                const fields = record.fields || {};

                                // Fetch mentor details
                                let mentorName = null;
                                const mentorId = Array.isArray(
                                    fields['Mentor Assigned']
                                )
                                    ? fields['Mentor Assigned'][0]
                                    : fields['Mentor Assigned'];

                                if (mentorId) {
                                    try {
                                        const mentorUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                                            AIRTABLE_BASE_ID
                                        )}/tbltF8lKcWspt0KHR/${encodeURIComponent(
                                            mentorId
                                        )}`;

                                        const mentorRes = await fetch(mentorUrl, {
                                            headers: {
                                                Authorization: `Bearer ${AIRTABLE_API_KEY}`
                                            }
                                        });

                                        if (mentorRes.ok) {
                                            const mentorRecord = await mentorRes.json();
                                            const mentorFields =
                                                mentorRecord.fields || {};
                                            const firstName =
                                                mentorFields['First Name'] || '';
                                            const lastName =
                                                mentorFields['Last Name'] || '';
                                            mentorName =
                                                [firstName, lastName]
                                                    .filter(Boolean)
                                                    .join(' ')
                                                    .trim() || null;
                                        }
                                    } catch (mentorErr) {
                                    }
                                }

                                airtableData = {
                                    startDate: fields['Course Start Date'],
                                    endDate: fields['Course End Date'],
                                    enrolledCourse: fields['Course Subject'],
                                    enrollingInstitution:
                                        fields['Enrolling Institution'],
                                    mentorName: mentorName
                                };
                            }
                        }
                    } catch (err) {
                    }
                }
            } catch (err) {
                // MongoDB query failed - continue without data
            }
        }

        // Fetch all lessons for the enrolled course
        const enrolledCourse = airtableData.enrolledCourse || 'Web Development';
        const allLessons = await lessonsCollection
            .find({ courseId: enrolledCourse })
            .sort({ level: 1, sectionOrder: 1, lessonOrder: 1 })
            .toArray();

        // Calculate total story points by course/level/section
        const totalCoursePoints = allLessons.reduce(
            (sum, l) => sum + Number(l.storyPoints || 0),
            0
        );

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
        const submittedLessonIds = new Set(
            allSubmissions.map((s) => s.lessonId).filter(Boolean)
        );

        // Find current lesson (last submitted)
        const currentLesson =
            allSubmissions.length > 0 ? allSubmissions[0] : null;

        // Find furthest lesson reached
        let furthestLesson = null;
        let furthestLessonData = null;

        if (allSubmissions.length > 0) {
            // Find the lesson with highest level, then section, then lesson order
            for (const submission of allSubmissions) {
                const lessonData = allLessons.find(
                    (l) => l.lessonId === submission.lessonId
                );
                if (lessonData) {
                    if (!furthestLessonData) {
                        furthestLessonData = lessonData;
                        furthestLesson = submission;
                    } else {
                        // Compare levels, sections, then lesson order
                        if (
                            lessonData.level > furthestLessonData.level ||
                            (lessonData.level === furthestLessonData.level &&
                                lessonData.sectionOrder >
                                    furthestLessonData.sectionOrder) ||
                            (lessonData.level === furthestLessonData.level &&
                                lessonData.sectionOrder ===
                                    furthestLessonData.sectionOrder &&
                                lessonData.lessonOrder >
                                    furthestLessonData.lessonOrder)
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

            // Count as completed if submitted OR if a later lesson has been submitted
            const isSubmitted = submittedLessonIds.has(lesson.lessonId);
            const isSkipped =
                furthestLessonData &&
                (lesson.level < furthestLessonData.level ||
                    (lesson.level === furthestLessonData.level &&
                        lesson.sectionOrder <
                            furthestLessonData.sectionOrder) ||
                    (lesson.level === furthestLessonData.level &&
                        lesson.sectionOrder ===
                            furthestLessonData.sectionOrder &&
                        lesson.lessonOrder < furthestLessonData.lessonOrder));

            if (isSubmitted || isSkipped) {
                const points = Number(lesson.storyPoints || 0);
                completedPoints += points;

                if (!completedByLevel[level]) completedByLevel[level] = 0;
                if (!completedBySection[section])
                    completedBySection[section] = 0;

                completedByLevel[level] += points;
                completedBySection[section] += points;
            }
        });

        // Calculate story points in selected date range
        const rangeSubmittedLessonIds = new Set(
            submissions.map((s) => s.lessonId).filter(Boolean)
        );
        let rangePoints = 0;
        allLessons.forEach((lesson) => {
            if (rangeSubmittedLessonIds.has(lesson.lessonId)) {
                rangePoints += Number(lesson.storyPoints || 0);
            }
        });

        // Calculate percentages for current location
        const currentLessonData = currentLesson
            ? allLessons.find((l) => l.lessonId === currentLesson.lessonId)
            : null;
        let sectionProgress = 0,
            levelProgress = 0,
            courseProgress = 0;

        if (currentLessonData) {
            const currentSection = `L${currentLessonData.level}-${currentLessonData.section}`;
            const currentLevel = currentLessonData.level;

            sectionProgress =
                pointsBySection[currentSection] > 0
                    ? ((completedBySection[currentSection] || 0) /
                          pointsBySection[currentSection]) *
                      100
                    : 0;
            levelProgress =
                pointsByLevel[currentLevel] > 0
                    ? ((completedByLevel[currentLevel] || 0) /
                          pointsByLevel[currentLevel]) *
                      100
                    : 0;
        }

        courseProgress =
            totalCoursePoints > 0
                ? (completedPoints / totalCoursePoints) * 100
                : 0;

        // Calculate attendance statistics
        const allDaysWithSubmissions = new Set();
        allSubmissions.forEach((sub) => {
            const dateStr = new Date(sub.createdAt).toISOString().slice(0, 10);
            allDaysWithSubmissions.add(dateStr);
        });

        // Get course dates (from mock data or Airtable)
        const courseStartDate = mockData?.startDate || airtableData?.startDate;
        const courseEndDate = mockData?.endDate || airtableData?.endDate;

        // All-time attendance percentage (based on course duration)
        let allTimeAttendancePercent = 0;
        let totalCourseDays = 0;

        if (courseStartDate && courseEndDate) {
            const courseStart = new Date(courseStartDate);
            const courseEnd = new Date(courseEndDate);
            const today = new Date();

            // Use the earlier of today or course end date
            const effectiveEnd = today < courseEnd ? today : courseEnd;

            // Calculate total course days from start to effective end
            totalCourseDays = Math.ceil((effectiveEnd - courseStart) / (1000 * 60 * 60 * 24)) + 1;

            // Calculate attendance percentage
            allTimeAttendancePercent = totalCourseDays > 0
                ? (allDaysWithSubmissions.size / totalCourseDays) * 100
                : 0;
        } else {
            // Fallback: use time since first submission if no course dates
            const firstSubmissionDate =
                allSubmissions.length > 0
                    ? new Date(allSubmissions[allSubmissions.length - 1].createdAt)
                    : new Date();
            totalCourseDays = Math.max(
                1,
                Math.ceil(
                    (new Date() - firstSubmissionDate) / (1000 * 60 * 60 * 24)
                )
            );
            allTimeAttendancePercent = (allDaysWithSubmissions.size / totalCourseDays) * 100;
        }

        // Last 7 days attendance
        const last7DaysStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
        let longestStreak = 0;
        let currentStreak = 0;
        let largestGap = 0;
        let tempStreak = 1;
        let tempGap = 0;

        // Calculate longest streak in history
        for (let i = 1; i < allDates.length; i++) {
            const prevDate = new Date(allDates[i - 1]);
            const currDate = new Date(allDates[i]);
            const dayDiff = Math.round(
                (currDate - prevDate) / (1000 * 60 * 60 * 24)
            );

            if (dayDiff === 1) {
                tempStreak++;
            } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 1;
                tempGap = dayDiff - 1;
                largestGap = Math.max(largestGap, tempGap);
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak);

        // Calculate current active streak (from today backwards)
        const today = new Date().toISOString().slice(0, 10);
        let checkDate = new Date();
        while (true) {
            const dateStr = checkDate.toISOString().slice(0, 10);
            if (allDaysWithSubmissions.has(dateStr)) {
                currentStreak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else if (dateStr === today) {
                // If today has no submission, check yesterday
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        // Average days attended per week
        const weeksSinceStart = Math.max(1, totalCourseDays / 7);
        const avgDaysPerWeek = allDaysWithSubmissions.size / weeksSinceStart;

        // Calculate current gap (days since last submission)
        let currentGap = 0;
        if (lastSubmission && lastSubmission.length > 0) {
            const lastSubmissionDate = new Date(lastSubmission[0].createdAt);
            const now = new Date();
            currentGap = Math.floor((now - lastSubmissionDate) / (1000 * 60 * 60 * 24));
        }

        // Calculate pace if we have start/end dates (from mock data or Airtable)
        let paceData = null;
        let estimatedEndDate = null;

        if (courseStartDate && courseEndDate) {
            const submittedLessonIds = allSubmissions.map(s => s.lessonId);
            paceData = calculatePace({
                courseLessons: allLessons,
                submittedLessonIds,
                courseStartDate: courseStartDate,
                courseEndDate: courseEndDate
            });

            // Calculate estimated end date based on current pace
            if (paceData.actualDailyPace > 0 && paceData.remainingStoryPoints > 0) {
                const daysNeeded = Math.ceil(paceData.remainingStoryPoints / paceData.actualDailyPace);
                const today = new Date();
                estimatedEndDate = new Date(today.getTime() + daysNeeded * 24 * 60 * 60 * 1000);
            } else if (paceData.isPastEndDate || paceData.remainingStoryPoints === 0) {
                estimatedEndDate = 'Complete';
            } else {
                estimatedEndDate = 'N/A';
            }
        }

        // Calculate total time spent (capped at 2 hours) and first-time only time
        const twoHoursMs = 2 * 60 * 60 * 1000;
        let totalTimeSpentMs = 0;
        let firstTimeOnlyMs = 0;

        // Need to determine first vs review for each submission (same logic as in table)
        const reversedForTime = [...submissions].reverse();
        const seenLessonsForTime = new Set();
        const submissionTypesForTime = new Map();
        let lastLessonIdForTime = null;

        reversedForTime.forEach(sub => {
            if (!sub.lessonId) return;
            const isFirstEver = !seenLessonsForTime.has(sub.lessonId);
            const isSameAsLast = sub.lessonId === lastLessonIdForTime;

            if (isFirstEver) {
                submissionTypesForTime.set(sub.createdAt.toISOString(), 'first');
                seenLessonsForTime.add(sub.lessonId);
            } else if (isSameAsLast) {
                submissionTypesForTime.set(sub.createdAt.toISOString(), 'first');
            } else {
                submissionTypesForTime.set(sub.createdAt.toISOString(), 'review');
            }
            lastLessonIdForTime = sub.lessonId;
        });

        // Calculate times (submissions are sorted newest first)
        for (let i = 1; i < submissions.length; i++) {
            const currentTime = new Date(submissions[i].createdAt);
            const previousTime = new Date(submissions[i - 1].createdAt);
            let diffMs = previousTime - currentTime;

            // Cap at 2 hours
            if (diffMs > twoHoursMs) {
                diffMs = twoHoursMs;
            }

            totalTimeSpentMs += diffMs;

            // Check if this is a first-time submission
            const subType = submissionTypesForTime.get(submissions[i].createdAt.toISOString()) || 'first';
            if (subType === 'first') {
                firstTimeOnlyMs += diffMs;
            }
        }

        // Format time helper with days/weeks support
        const formatTimeMs = (ms) => {
            const weeks = Math.floor(ms / (1000 * 60 * 60 * 24 * 7));
            const days = Math.floor((ms % (1000 * 60 * 60 * 24 * 7)) / (1000 * 60 * 60 * 24));
            const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

            if (weeks > 0) {
                return weeks + 'w ' + days + 'd ' + hours + 'h';
            } else if (days > 0) {
                return days + 'd ' + hours + 'h ' + minutes + 'm';
            } else if (hours > 0) {
                return hours + 'h ' + minutes + 'm';
            }
            return minutes + 'm';
        };

        const reviewTimeMs = totalTimeSpentMs - firstTimeOnlyMs;
        const totalTimeSpentDisplay = formatTimeMs(totalTimeSpentMs);
        const firstTimeOnlyDisplay = formatTimeMs(firstTimeOnlyMs);
        const reviewTimeDisplay = formatTimeMs(reviewTimeMs);

        // Calculate working days (8 hours = 1 day)
        const eightHoursMs = 8 * 60 * 60 * 1000;
        const workingDays = totalTimeSpentMs / eightHoursMs;
        const workingDaysDisplay = workingDays.toFixed(1) + ' days';

        // Render HTML page
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(studentName)} - Student Details</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background: #f9fafb;
      color: #111827;
    }
    .navbar {
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 0 2rem;
      display: flex;
      align-items: center;
      gap: 2rem;
      height: 64px;
    }
    .navbar-brand a {
      font-size: 1.5rem;
      font-weight: 600;
      color: #2d3748;
      text-decoration: none;
    }
    .navbar-brand a:hover {
      color: #4299e1;
    }
    .navbar-menu {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
    }
    .navbar-item {
      padding: 0.5rem 1rem;
      color: #4a5568;
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 0.375rem;
      transition: all 0.2s;
    }
    .navbar-item:hover {
      background: #f7fafc;
      color: #4299e1;
    }

    h1,
    h2,
    .header-info-value,
    .stat-value,
    .filter-btn,
    .pill {
      color: #111827;
    }

    .header,
    .card,
    .date-filter,
    .filter-btn.secondary {
      background: #fff;
      color: #111827;
      border-color: #e5e7eb;
    }

    .pill.active,
    .filter-btn {
      background: #111;
      color: #fff;
      border-color: #111;
    }

    .subtitle,
    .header-info-label {
      color: #6b7280;
    }
    .back-btn {
      background: #111827;
      color: #fff;
    }
    .back-btn:hover {
      background: #374151;
    }
    table {
      color: #111827;
    }
    th,
    td {
      border-color: #e5e7eb;
    }
    th {
      background: #f9fafb;
    }
    tr:hover {
      background: rgba(0,0,0,0.03);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }
    .header {
      background: white;
      padding: 24px;
      border-radius: 12px;
      border: 1px solid #8f97a8;
      margin-bottom: 24px;
      display: grid;
      grid-template-columns: auto 1fr 2fr;
      gap: 24px;
      align-items: center;
    }
    .header-profile-pic {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #e5e7eb;
    }
    .header-profile-placeholder {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: #cbd5e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40px;
      border: 3px solid #e5e7eb;
    }
    .header-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px 32px;
      font-size: 14px;
    }
    .header-info-item {
      display: flex;
      gap: 8px;
    }
    .header-info-label {
      color: #6b7280;
      white-space: nowrap;
    }
    .header-info-value {
      color: #111827;
      font-weight: 500;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      color: #111827;
    }
    .subtitle {
      color: #6b7280;
      font-size: 14px;
    }
    .back-btn {
      display: inline-block;
      margin-bottom: 16px;
      padding: 8px 14px;
      background: #111827;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-size: 14px;
    }
    .back-btn:hover {
      background: #374151;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      margin-bottom: 24px;
    }
    @media (min-width: 768px) {
      .grid {
        grid-template-columns: 1fr 1fr;
      }
    }
    .card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #8f97a8;
    }
    .card h2 {
      margin: 0 0 16px;
      font-size: 18px;
      color: #111827;
    }
    .stat-grid {
      display: grid;
      gap: 12px;
    }
    .stat-row {
      display: grid;
      grid-template-columns: 180px 1fr;
      padding: 8px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .stat-row:last-child {
      border-bottom: none;
    }
    .stat-label {
      color: #6b7280;
      font-size: 14px;
    }
    .stat-value {
      color: #111827;
      font-size: 14px;
      font-weight: 500;
    }
    .submissions-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .submissions-table th,
    .submissions-table td {
      padding: 10px 8px;
      text-align: left;
      border-bottom: 1px solid #8f97a8;
    }
    .submissions-table th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
    .submissions-table tr:hover {
      background: #f9fafb;
    }
    .chart-container {
      margin-top: 20px;
      height: 400px;
    }
    .date-filter {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 24px;
      padding: 16px;
      background: white;
      border-radius: 12px;
      border: 1px solid #8f97a8;
      
    }
    .date-input {
      padding: 8px 12px;
      border: 1px solid #8f97a8;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font-size: 14px;
    }
    .filter-btn {
      padding: 8px 16px;
      border: 1px solid #111827;
      border-radius: 8px;
      background: #111827;
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    .filter-btn:hover {
      background: #374151;
    }
    .filter-btn.secondary {
      background: transparent;
      color: #111827;
      border-color: #e5e7eb;
    }
    .filter-btn.secondary:hover {
      background: #f3f4f6;
    }
    .pill {
      border: 1px solid #8f97a8;
      border-radius: 9999px;
      padding: 6px 12px;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
    }
    .pill.active {
      background: #111;
      color: #fff;
      border-color: #111;
    }
    .progress-bar {
      width: 100%;
      height: 8px;
      background: #b1b2b5;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 4px;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      transition: width 0.3s ease;
    }
    .big-stat {
      font-size: 32px;
      font-weight: 700;
      color: #2563eb;
      margin: 8px 0;
    }
  </style>
</head>
<body>
  <nav class="navbar">
    <div class="navbar-brand">
      <a href="/">LTP Reports</a>
    </div>
    <div class="navbar-menu">
      <a href="/" class="navbar-item">🏠 Home</a>
      <a href="/dashboards.html" class="navbar-item">📊 Dashboards</a>
      <a href="/admin-users.html" class="navbar-item">👥 Users</a>
      <a href="/.netlify/functions/report-weekly?view=html" class="navbar-item">📈 Weekly Report</a>
      <a href="/.netlify/functions/db-inspect?format=pretty" class="navbar-item">🔍 Database</a>
    </div>
  </nav>
  <div class="container">

    <div class="header">
      ${
          airtableData.profilePictureUrl
              ? `<img src="${airtableData.profilePictureUrl}" alt="${escapeHtml(
                    studentName
                )}" class="header-profile-pic">`
              : '<div class="header-profile-placeholder">👤</div>'
      }
      <div>
        <h1>${escapeHtml(studentName)}</h1>
        <div class="subtitle">Student ID: ${escapeHtml(studentId)}</div>
      </div>
      <div class="header-info">
        <div class="header-info-item">
          <div class="header-info-label">Course:</div>
          <div class="header-info-value">${escapeHtml(
              airtableData.enrolledCourse || '—'
          )}</div>
        </div>
        <div class="header-info-item">
          <div class="header-info-label">Institution:</div>
          <div class="header-info-value">${escapeHtml(
              airtableData.enrollingInstitution || '—'
          )}</div>
        </div>
        <div class="header-info-item">
          <div class="header-info-label">Mentor:</div>
          <div class="header-info-value">${escapeHtml(
              airtableData.mentorName || '—'
          )}</div>
        </div>
        <div class="header-info-item">
          <div class="header-info-label">Course Start:</div>
          <div class="header-info-value">${
              airtableData.startDate
                  ? new Date(airtableData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—'
          }</div>
        </div>
        <div class="header-info-item">
          <div class="header-info-label">Course End:</div>
          <div class="header-info-value">${
              airtableData.endDate
                  ? new Date(airtableData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—'
          }</div>
        </div>
        ${estimatedEndDate ? `<div class="header-info-item">
          <div class="header-info-label">Estimated End:</div>
          <div class="header-info-value">${typeof estimatedEndDate === 'string' ? estimatedEndDate : estimatedEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>` : ''}
      </div>
    </div>

    <!-- Date Range Filter -->
    <div class="date-filter">
      <label style="font-size: 14px; font-weight: 500;">Date Range:</label>
      <button class="pill ${
          days === 'fullPeriod' && !isCustomRange ? 'active' : ''
      }" onclick="setDays('fullPeriod')">Full Period</button>
      <button class="pill ${
          days === 7 && !isCustomRange ? 'active' : ''
      }" onclick="setDays(7)">7d</button>
      <button class="pill ${
          days === 30 && !isCustomRange ? 'active' : ''
      }" onclick="setDays(30)">30d</button>
      <div style="border-left: 1px solid #8f97a8; height: 24px; margin: 0 4px;"></div>
      <input type="date" id="startDate" class="date-input" value="${
          startDate || ''
      }" placeholder="Start Date">
      <input type="date" id="endDate" class="date-input" value="${
          endDate || ''
      }" placeholder="End Date">
      <button class="filter-btn" onclick="applyCustomRange()">Apply</button>
      <button class="filter-btn secondary" onclick="clearRange()">Clear</button>
    </div>

    <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
      <div class="card">
        <h2>Submission Statistics</h2>
        <div class="stat-grid">
          <div class="stat-row">
            <div class="stat-label">Total Submissions</div>
            <div class="stat-value">${allTimeTotal}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Submissions (${escapeHtml(
                rangeLabel
            )})</div>
            <div class="stat-value">${rangeTotal}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Active Days</div>
            <div class="stat-value">${totalActiveDays}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Last Submission</div>
            <div class="stat-value">${
                lastSubmission[0]
                    ? new Date(lastSubmission[0].createdAt).toLocaleString()
                    : '—'
            }</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Last Lesson</div>
            <div class="stat-value">${escapeHtml(
                lastSubmission[0]?.lessonTitle || '—'
            )}</div>
          </div>
          <div class="stat-row" style="border-top: 2px solid #e5e7eb; margin-top: 8px; padding-top: 12px;">
            <div class="stat-label">Total Time Spent</div>
            <div class="stat-value">${totalTimeSpentDisplay}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">First-Time Only</div>
            <div class="stat-value">${firstTimeOnlyDisplay}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Total Review Time</div>
            <div class="stat-value">${reviewTimeDisplay}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Working Days (8hr = 1 day)</div>
            <div class="stat-value">${workingDaysDisplay}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Attendance Statistics</h2>
        <div class="stat-grid">
          <div class="stat-row">
            <div class="stat-label">All-Time Attendance</div>
            <div class="stat-value">${allDaysWithSubmissions.size} / ${totalCourseDays} days (${allTimeAttendancePercent.toFixed(
                1
            )}%)</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Last 7 Days</div>
            <div class="stat-value">${last7DaysAttended} / 7 days</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Avg Days Per Week</div>
            <div class="stat-value">${avgDaysPerWeek.toFixed(1)} days</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Current Streak</div>
            <div class="stat-value">${currentStreak} days</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Longest Streak</div>
            <div class="stat-value">${longestStreak} days</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Largest Gap</div>
            <div class="stat-value">${largestGap} days</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Current Gap</div>
            <div class="stat-value">${currentGap} days</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Current Location</h2>
        <div class="stat-grid">
          <div class="stat-row">
            <div class="stat-label">Current Lesson</div>
            <div class="stat-value">${escapeHtml(
                currentLessonData?.title || '—'
            )}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Current Level</div>
            <div class="stat-value">Level ${
                currentLessonData?.level || '—'
            }</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Current Section</div>
            <div class="stat-value">${escapeHtml(
                currentLessonData?.section || '—'
            )}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Furthest Progress</div>
            <div class="stat-value">${furthestLessonData?.lessonId || '—'}</div>
          </div>
        </div>
      </div>

      ${paceData ? `<div class="card">
        <h2>Pace Tracker</h2>
        <div class="stat-grid">
          <div class="stat-row">
            <div class="stat-label">Required Daily Pace</div>
            <div class="stat-value">${paceData.requiredDailyPace} pts/day</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Actual Daily Pace</div>
            <div class="stat-value">${paceData.actualDailyPace} pts/day</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Days Remaining</div>
            <div class="stat-value">${paceData.daysRemaining} days</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Pace Status</div>
            <div class="stat-value" style="color: ${paceData.paceStatus === 'ahead' ? '#10b981' : paceData.paceStatus === 'on-pace' ? '#3b82f6' : paceData.paceStatus === 'behind' ? '#ef4444' : '#9ca3af'}; font-weight: 600; text-transform: capitalize;">
              ${(() => {
                if (paceData.paceStatus === 'dnf') return 'DNF';
                const pacePercentage = paceData.expectedStoryPoints > 0
                  ? ((paceData.completedStoryPoints - paceData.expectedStoryPoints) / paceData.expectedStoryPoints * 100).toFixed(1)
                  : 0;
                const paceText = paceData.paceStatus.replace('-', ' ');
                if (paceData.paceStatus === 'ahead') return paceText + ' (' + Math.abs(pacePercentage) + '%)';
                if (paceData.paceStatus === 'behind') return paceText + ' (' + Math.abs(pacePercentage) + '%)';
                return paceText + ' (' + Math.abs(pacePercentage) + '%)';
              })()}
              <div style="font-size: 0.875rem; font-weight: 400; color: #6b7280; text-transform: none; margin-top: 4px;">
                ${(() => {
                  if (paceData.paceStatus === 'dnf') return 'Did not finish by course end date';
                  const pacePercentage = paceData.expectedStoryPoints > 0
                    ? ((paceData.completedStoryPoints - paceData.expectedStoryPoints) / paceData.expectedStoryPoints * 100).toFixed(1)
                    : 0;
                  if (paceData.paceStatus === 'ahead') return Math.abs(pacePercentage) + '% ahead of expected progress';
                  if (paceData.paceStatus === 'behind') return Math.abs(pacePercentage) + '% behind expected progress';
                  return 'Within 5% of expected progress';
                })()}
              </div>
            </div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Story Points Completed</div>
            <div class="stat-value">${paceData.completedStoryPoints} / ${paceData.totalStoryPoints}</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Story Points Remaining</div>
            <div class="stat-value">${paceData.remainingStoryPoints} pts</div>
          </div>
          <div class="stat-row">
            <div class="stat-label">Estimated End Date</div>
            <div class="stat-value">
              ${(() => {
                if (typeof estimatedEndDate === 'string') return estimatedEndDate;
                const estDateStr = estimatedEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const courseEnd = new Date(courseEndDate);
                const diffMs = estimatedEndDate - courseEnd;
                const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                if (diffDays > 0) return estDateStr + ' (' + diffDays + ' days behind)';
                if (diffDays < 0) return estDateStr + ' (' + Math.abs(diffDays) + ' days ahead)';
                return estDateStr + ' (on time)';
              })()}
            </div>
          </div>
        </div>
      </div>` : ''}
    </div>

    <!-- Progress Percentages & Attendance -->
    <div class="grid">
      <div class="card">
        <h2>Progress Breakdown</h2>
        <div style="margin-bottom: 16px;">
          <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">
            Section Progress
          </div>
          <div style="font-size: 24px; font-weight: 600; color: #2563eb; margin-bottom: 8px;">
            ${sectionProgress.toFixed(1)}%
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${sectionProgress.toFixed(
                1
            )}%"></div>
          </div>
        </div>
        <div>
          <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">
            Level Progress
          </div>
          <div style="font-size: 24px; font-weight: 600; color: #2563eb; margin-bottom: 8px;">
            ${levelProgress.toFixed(1)}%
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${levelProgress.toFixed(
                1
            )}%"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Story Points Progress</h2>
        <div class="big-stat">${completedPoints} / ${totalCoursePoints}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${courseProgress.toFixed(
              1
          )}%"></div>
        </div>
        <div style="margin-top: 8px; color: #6b7280; font-size: 13px;">
          ${courseProgress.toFixed(1)}% of total course completed
        </div>
        <div style="margin-top: 20px;">
          <div class="stat-row">
            <div class="stat-label">Story Points (${escapeHtml(
                rangeLabel
            )})</div>
            <div class="stat-value">${rangePoints}</div>
          </div>
        </div>
      </div>

      
    </div>

    <div class="card" style="margin-top: 24px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="margin: 0;">Activity Timeline</h2>
        <div style="display: flex; gap: 16px; font-size: 14px;">
          <label style="cursor: pointer; user-select: none;">
            <input type="checkbox" id="toggle-story-points" checked style="margin-right: 4px;">
            Story Points
          </label>
          <label style="cursor: pointer; user-select: none;">
            <input type="checkbox" id="toggle-attendance" checked style="margin-right: 4px;">
            Attendance
          </label>
        </div>
      </div>
      <div class="chart-container">
        <canvas id="timeline-chart"></canvas>
      </div>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <h2 style="margin: 0;">Recent Submissions (${submissions.length})</h2>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span style="font-size: 13px; color: #6b7280;">Filter:</span>
          <button class="pill active" id="filter-all" onclick="filterSubmissions('all')">All</button>
          <button class="pill" id="filter-first" onclick="filterSubmissions('first')">First Time</button>
          <button class="pill" id="filter-review" onclick="filterSubmissions('review')">Review</button>
        </div>
      </div>
      <div style="overflow-x: auto;">
        <table class="submissions-table" id="submissions-table">
          <thead>
            <tr>
              <th class="sortable" data-sort="date" onclick="sortTable('date')" style="cursor: pointer;">Date & Time <span id="sort-date" class="sort-arrow"></span></th>
              <th>Lesson ID</th>
              <th>Lesson Title</th>
              <th class="sortable" data-sort="timeSpent" onclick="sortTable('timeSpent')" style="cursor: pointer;">Time Spent <span id="sort-timeSpent" class="sort-arrow"></span></th>
              <th id="total-time-header" class="sortable" data-sort="totalTime" onclick="sortTable('totalTime')" style="cursor: pointer;">Total Time <span id="sort-totalTime" class="sort-arrow"></span></th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${(() => {
                // Determine first-time vs review submissions
                // A submission is "review" only if they worked on a DIFFERENT lesson
                // between the first submission and this one
                // Iterate from oldest to newest
                const reversedSubs = [...submissions].reverse();
                const seenLessons = new Set();
                const submissionTypes = new Map();
                let lastLessonId = null;

                reversedSubs.forEach(sub => {
                    if (!sub.lessonId) return;

                    const isFirstEver = !seenLessons.has(sub.lessonId);
                    const isSameAsLast = sub.lessonId === lastLessonId;

                    if (isFirstEver) {
                        // First time seeing this lesson
                        submissionTypes.set(sub.createdAt.toISOString(), 'first');
                        seenLessons.add(sub.lessonId);
                    } else if (isSameAsLast) {
                        // Same lesson as last submission - still part of first visit
                        submissionTypes.set(sub.createdAt.toISOString(), 'first');
                    } else {
                        // We've seen this lesson before AND worked on something else in between
                        submissionTypes.set(sub.createdAt.toISOString(), 'review');
                    }

                    lastLessonId = sub.lessonId;
                });

                // Calculate total time per lesson and first-time only per lesson
                // Time is calculated the same way as the Time Spent column
                const twoHoursCap = 2 * 60 * 60 * 1000;
                const lessonTotalTime = new Map(); // lessonId -> total ms
                const lessonFirstTime = new Map(); // lessonId -> first-time only ms
                const lessonTitles = new Map(); // lessonId -> title

                // Process submissions (newest first) - same logic as Time Spent column
                for (let i = 1; i < submissions.length; i++) {
                    const sub = submissions[i];
                    if (!sub.lessonId) continue;

                    const currentTime = new Date(sub.createdAt);
                    const previousTime = new Date(submissions[i - 1].createdAt);
                    let diffMs = previousTime - currentTime;

                    // Cap at 2 hours
                    if (diffMs > twoHoursCap) {
                        diffMs = twoHoursCap;
                    }

                    // Store lesson title
                    if (!lessonTitles.has(sub.lessonId)) {
                        lessonTitles.set(sub.lessonId, sub.lessonTitle || sub.lessonId);
                    }

                    // Add to lesson total
                    lessonTotalTime.set(sub.lessonId, (lessonTotalTime.get(sub.lessonId) || 0) + diffMs);

                    // Add to first-time only if this is a first submission
                    const subType = submissionTypes.get(sub.createdAt.toISOString()) || 'first';
                    if (subType === 'first') {
                        lessonFirstTime.set(sub.lessonId, (lessonFirstTime.get(sub.lessonId) || 0) + diffMs);
                    }
                }

                // Store lesson stats globally for modal access
                const lessonStatsJson = JSON.stringify({
                    totals: Object.fromEntries(lessonTotalTime),
                    firstTime: Object.fromEntries(lessonFirstTime),
                    titles: Object.fromEntries(lessonTitles)
                });

                // Helper to format time
                const formatMs = (ms) => {
                    if (!ms || ms === 0) return '—';
                    const hours = Math.floor(ms / (1000 * 60 * 60));
                    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                    if (hours > 0) {
                        return hours + 'h ' + minutes + 'm';
                    }
                    return minutes + 'm';
                };

                return submissions.map((sub, index) => {
                    // Calculate time spent
                    let timeSpent = '—';
                    let breakTimeMs = 0;
                    const twoHoursMs = 2 * 60 * 60 * 1000;

                    if (index > 0) {
                        const currentTime = new Date(sub.createdAt);
                        const previousTime = new Date(submissions[index - 1].createdAt);
                        let diffMs = previousTime - currentTime;

                        // Cap at 2 hours
                        if (diffMs > twoHoursMs) {
                            breakTimeMs = diffMs - twoHoursMs;
                            diffMs = twoHoursMs;
                        }

                        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                        if (diffHours > 0) {
                            timeSpent = diffHours + 'h ' + diffMinutes + 'm';
                        } else if (diffMinutes > 0) {
                            timeSpent = diffMinutes + 'm';
                        } else {
                            const diffSeconds = Math.floor(diffMs / 1000);
                            timeSpent = diffSeconds + 's';
                        }
                    }

                    const subType = submissionTypes.get(sub.createdAt.toISOString()) || 'first';
                    const isReview = subType === 'review';
                    const rowStyle = isReview ? 'background: #fef3c7;' : '';
                    const typeBadge = isReview
                        ? '<span style="background: #f59e0b; color: white; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600;">Review</span>'
                        : '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600;">First</span>';

                    let rowHtml = '';

                    // Add break time row BEFORE the submission if time exceeded 2 hours
                    // (the break happened between this submission and the next one)
                    if (breakTimeMs > 0) {
                        const breakWeeks = Math.floor(breakTimeMs / (1000 * 60 * 60 * 24 * 7));
                        const breakDays = Math.floor((breakTimeMs % (1000 * 60 * 60 * 24 * 7)) / (1000 * 60 * 60 * 24));
                        const breakHours = Math.floor((breakTimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        const breakMinutes = Math.floor((breakTimeMs % (1000 * 60 * 60)) / (1000 * 60));

                        let breakTimeDisplay = '';
                        if (breakWeeks > 0) {
                            breakTimeDisplay = breakWeeks + 'w ' + breakDays + 'd ' + breakHours + 'h';
                        } else if (breakDays > 0) {
                            breakTimeDisplay = breakDays + 'd ' + breakHours + 'h ' + breakMinutes + 'm';
                        } else if (breakHours > 0) {
                            breakTimeDisplay = breakHours + 'h ' + breakMinutes + 'm';
                        } else {
                            breakTimeDisplay = breakMinutes + 'm';
                        }

                        rowHtml += '<tr data-type="break" style="background: #dbeafe;">' +
                            '<td style="color: #1d4ed8; font-weight: 500;">Break Time</td>' +
                            '<td style="background: #dbeafe;"></td>' +
                            '<td style="background: #dbeafe;"></td>' +
                            '<td style="color: #1d4ed8; font-weight: 600;">' + breakTimeDisplay + '</td>' +
                            '<td style="background: #dbeafe;"></td>' +
                            '<td><span style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600;">Break</span></td>' +
                            '</tr>';
                    }

                    // Get lesson totals for modal
                    const lessonTotal = lessonTotalTime.get(sub.lessonId) || 0;
                    const lessonFirst = lessonFirstTime.get(sub.lessonId) || 0;
                    const lessonReview = lessonTotal - lessonFirst;

                    // Calculate time spent in ms for sorting (use the capped value)
                    let timeSpentMs = 0;
                    if (index > 0) {
                        const currentT = new Date(sub.createdAt);
                        const previousT = new Date(submissions[index - 1].createdAt);
                        timeSpentMs = Math.min(previousT - currentT, twoHoursMs);
                    }

                    rowHtml += '<tr data-type="' + subType + '" data-total-time="' + formatMs(lessonTotal) + '" data-review-time="' + formatMs(lessonReview) + '" data-date="' + new Date(sub.createdAt).getTime() + '" data-time-spent-ms="' + timeSpentMs + '" data-total-time-ms="' + lessonTotal + '" data-review-time-ms="' + lessonReview + '" style="' + rowStyle + '">' +
                        '<td>' + new Date(sub.createdAt).toLocaleString() + '</td>' +
                        '<td style="font-family: monospace; font-size: 12px;">' + escapeHtml(sub.lessonId || '—') + '</td>' +
                        '<td><a href="#" onclick="showLessonStats(\'' + escapeHtml(sub.lessonId || '') + '\', \'' + escapeHtml(sub.lessonTitle || '').replace(/'/g, "\\'") + '\', ' + lessonTotal + ', ' + lessonFirst + ', ' + lessonReview + '); return false;" style="color: #2563eb; text-decoration: underline; cursor: pointer;">' + escapeHtml(sub.lessonTitle || '—') + '</a></td>' +
                        '<td>' + timeSpent + '</td>' +
                        '<td class="total-time-cell" style="font-weight: 600;">' + formatMs(lessonTotal) + '</td>' +
                        '<td>' + typeBadge + '</td>' +
                        '</tr>';

                    return rowHtml;
                }).join('');
            })()}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Lesson Stats Modal -->
  <div id="lesson-stats-modal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
    <div style="background: white; border-radius: 12px; padding: 24px; max-width: 400px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
        <h3 id="lesson-stats-title" style="margin: 0; font-size: 18px; color: #111;">Lesson Stats</h3>
        <button onclick="closeLessonStats()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666; line-height: 1;">&times;</button>
      </div>
      <div id="lesson-stats-id" style="font-family: monospace; font-size: 12px; color: #666; margin-bottom: 16px;"></div>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; padding: 12px; background: #f3f4f6; border-radius: 8px;">
          <span style="color: #374151; font-weight: 500;">Total Time</span>
          <span id="lesson-stats-total" style="font-weight: 700; color: #111;"></span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 12px; background: #d1fae5; border-radius: 8px;">
          <span style="color: #065f46; font-weight: 500;">First-Time</span>
          <span id="lesson-stats-first" style="font-weight: 700; color: #059669;"></span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 12px; background: #fef3c7; border-radius: 8px;">
          <span style="color: #92400e; font-weight: 500;">Review Time</span>
          <span id="lesson-stats-review" style="font-weight: 700; color: #d97706;"></span>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>
    const series = ${JSON.stringify(series)};
    const allSubmissions = ${JSON.stringify(
        allSubmissions.map((s) => ({
            lessonId: s.lessonId,
            date: s.createdAt.toISOString().slice(0, 10)
        }))
    )};
    const allLessons = ${JSON.stringify(
        allLessons.map((l) => ({
            lessonId: l.lessonId,
            storyPoints: l.storyPoints
        }))
    )};

    // Create lesson lookup map
    const lessonMap = new Map(allLessons.map(l => [l.lessonId, parseInt(l.storyPoints || 0, 10)]));

    // Calculate story points per day
    const storyPointsByDate = new Map();
    const submissionCountByDate = new Map();

    allSubmissions.forEach(sub => {
      const date = sub.date;
      const points = lessonMap.get(sub.lessonId) || 0;

      storyPointsByDate.set(date, (storyPointsByDate.get(date) || 0) + points);
      submissionCountByDate.set(date, (submissionCountByDate.get(date) || 0) + 1);
    });

    // Merge with series data
    const enrichedSeries = series.map(s => ({
      date: s.date,
      submissions: s.count,
      storyPoints: storyPointsByDate.get(s.date) || 0,
      hasAttendance: s.count > 0
    }));

    // Determine grouping
    const daysDiff = series.length;
    const groupBy = daysDiff >= 30 ? 'week' : 'day';

    function groupData(data, grouping) {
      if (grouping === 'day') return data;

      const grouped = new Map();
      data.forEach(item => {
        const date = new Date(item.date + 'T00:00:00');
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(date);
        monday.setDate(diff);
        const key = monday.toISOString().slice(0, 10);

        if (!grouped.has(key)) {
          grouped.set(key, { date: key, submissions: 0, storyPoints: 0, hasAttendance: false });
        }
        const group = grouped.get(key);
        group.submissions += item.submissions;
        group.storyPoints += item.storyPoints;
        group.hasAttendance = group.hasAttendance || item.hasAttendance;
      });

      return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
    }

    const grouped = groupData(enrichedSeries, groupBy);
    const labels = grouped.map(d => {
      if (groupBy === 'week') {
        return 'Week of ' + new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    });

    // Chart instance
    let chart = null;

    function renderChart() {
      const showStoryPoints = document.getElementById('toggle-story-points').checked;
      const showAttendance = document.getElementById('toggle-attendance').checked;

      // Handle empty state
      if (!grouped || grouped.length === 0) {
        const ctx = document.getElementById('timeline-chart');
        const emptyMessage = document.createElement('div');
        emptyMessage.style.cssText = 'text-align: center; padding: 60px 20px; color: #6b7280; font-size: 16px;';
        emptyMessage.textContent = 'No activity data available for the selected date range';
        ctx.parentElement.appendChild(emptyMessage);
        ctx.style.display = 'none';
        return;
      }

      const datasets = [];

      if (showStoryPoints) {
        datasets.push({
          label: 'Story Points',
          data: grouped.map(d => d.storyPoints),
          backgroundColor: 'rgba(37, 99, 235, 0.7)',
          borderColor: 'rgba(37, 99, 235, 1)',
          borderWidth: 1,
          submissions: grouped.map(d => d.submissions)
        });
      }

      const ctx = document.getElementById('timeline-chart');
      if (chart) chart.destroy();

      chart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => items[0].label,
                label: (item) => {
                  const lines = [];
                  const datasetIndex = item.datasetIndex;
                  const dataIndex = item.dataIndex;
                  const submissions = item.dataset.submissions[dataIndex];
                  const storyPoints = grouped[dataIndex].storyPoints;

                  lines.push('Submissions: ' + submissions);
                  lines.push('Story Points: ' + storyPoints);
                  return lines;
                }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 45,
                autoSkip: true,
                maxTicksLimit: 20
              },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { precision: 0 },
              grid: { color: 'rgba(0, 0, 0, 0.05)' },
              title: {
                display: showStoryPoints,
                text: 'Story Points'
              }
            }
          }
        },
        plugins: showAttendance ? [{
          id: 'attendanceDots',
          afterDatasetsDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;

            grouped.forEach((d, i) => {
              if (d.hasAttendance) {
                const x = xAxis.getPixelForValue(i);
                const y = yAxis.top - 10;

                ctx.beginPath();
                ctx.arc(x, y, 4, 0, 2 * Math.PI);
                ctx.fillStyle = '#10b981';
                ctx.fill();
              }
            });
          }
        }] : []
      });
    }

    // Initial render
    renderChart();

    // Toggle listeners
    document.getElementById('toggle-story-points').addEventListener('change', renderChart);
    document.getElementById('toggle-attendance').addEventListener('change', renderChart);

    // Date filter functions
    const STUDENT_ID = '${escapeHtml(studentId)}';
    const STUDENT_NAME = '${escapeHtml(studentName)}';

    function setDays(d) {
      const url = new URL(window.location.href);
      url.searchParams.delete('startDate');
      url.searchParams.delete('endDate');
      url.searchParams.set('days', d);
      window.location.href = url.toString();
    }

    function applyCustomRange() {
      const start = document.getElementById('startDate').value;
      const end = document.getElementById('endDate').value;

      if (!start || !end) {
        alert('Please select both start and end dates');
        return;
      }

      // Validate date range
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (startDate > endDate) {
        alert('Start date must be before or equal to end date');
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.delete('days');
      url.searchParams.set('startDate', start);
      url.searchParams.set('endDate', end);
      window.location.href = url.toString();
    }

    function clearRange() {
      const url = new URL(window.location.href);
      url.searchParams.delete('startDate');
      url.searchParams.delete('endDate');
      url.searchParams.set('days', 'fullPeriod');
      window.location.href = url.toString();
    }

    // Lesson stats modal functions
    function formatMsDisplay(ms) {
      if (!ms || ms === 0) return '0m';
      const hours = Math.floor(ms / (1000 * 60 * 60));
      const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      if (hours > 0) {
        return hours + 'h ' + minutes + 'm';
      }
      return minutes + 'm';
    }

    function showLessonStats(lessonId, lessonTitle, totalMs, firstMs, reviewMs) {
      document.getElementById('lesson-stats-title').textContent = lessonTitle || 'Unknown Lesson';
      document.getElementById('lesson-stats-id').textContent = lessonId;
      document.getElementById('lesson-stats-total').textContent = formatMsDisplay(totalMs);
      document.getElementById('lesson-stats-first').textContent = formatMsDisplay(firstMs);
      document.getElementById('lesson-stats-review').textContent = formatMsDisplay(reviewMs);
      document.getElementById('lesson-stats-modal').style.display = 'flex';
    }

    function closeLessonStats() {
      document.getElementById('lesson-stats-modal').style.display = 'none';
    }

    // Close modal on backdrop click
    document.getElementById('lesson-stats-modal').addEventListener('click', function(e) {
      if (e.target === this) {
        closeLessonStats();
      }
    });

    // Submission filter functions
    function filterSubmissions(type) {
      const table = document.getElementById('submissions-table');
      const rows = table.querySelectorAll('tbody tr');
      const filterAll = document.getElementById('filter-all');
      const filterFirst = document.getElementById('filter-first');
      const filterReview = document.getElementById('filter-review');
      const totalTimeHeader = document.getElementById('total-time-header');

      // Update active button
      filterAll.classList.remove('active');
      filterFirst.classList.remove('active');
      filterReview.classList.remove('active');

      if (type === 'all') {
        filterAll.classList.add('active');
      } else if (type === 'first') {
        filterFirst.classList.add('active');
      } else if (type === 'review') {
        filterReview.classList.add('active');
      }

      // Update header and cell values based on filter
      if (type === 'review') {
        totalTimeHeader.textContent = 'Review Time';
      } else {
        totalTimeHeader.textContent = 'Total Time';
      }

      // Filter rows and update Total Time column
      rows.forEach(row => {
        const rowType = row.getAttribute('data-type');
        const totalTimeCell = row.querySelector('.total-time-cell');

        // Update the cell value based on filter type
        if (totalTimeCell) {
          if (type === 'review') {
            totalTimeCell.textContent = row.getAttribute('data-review-time') || '—';
          } else {
            totalTimeCell.textContent = row.getAttribute('data-total-time') || '—';
          }
        }

        // Filter visibility
        if (type === 'all') {
          row.style.display = '';
        } else if (rowType === type) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    // Sorting state
    let currentSortColumn = null;
    let currentSortDirection = 'desc'; // 'asc' or 'desc'

    function sortTable(column) {
      const table = document.getElementById('submissions-table');
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));

      // Determine sort direction
      if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortColumn = column;
        currentSortDirection = 'desc'; // Default to descending (newest/highest first)
      }

      // Get the current filter to determine which value to use for totalTime
      const isReviewFilter = document.getElementById('filter-review').classList.contains('active');

      // Separate break rows from data rows
      const breakRows = rows.filter(r => r.getAttribute('data-type') === 'break');
      const dataRows = rows.filter(r => r.getAttribute('data-type') !== 'break');

      // Sort data rows
      dataRows.sort((a, b) => {
        let aVal, bVal;

        if (column === 'date') {
          aVal = parseInt(a.getAttribute('data-date') || '0', 10);
          bVal = parseInt(b.getAttribute('data-date') || '0', 10);
        } else if (column === 'timeSpent') {
          aVal = parseInt(a.getAttribute('data-time-spent-ms') || '0', 10);
          bVal = parseInt(b.getAttribute('data-time-spent-ms') || '0', 10);
        } else if (column === 'totalTime') {
          // Use review time if review filter is active, otherwise use total time
          if (isReviewFilter) {
            aVal = parseInt(a.getAttribute('data-review-time-ms') || '0', 10);
            bVal = parseInt(b.getAttribute('data-review-time-ms') || '0', 10);
          } else {
            aVal = parseInt(a.getAttribute('data-total-time-ms') || '0', 10);
            bVal = parseInt(b.getAttribute('data-total-time-ms') || '0', 10);
          }
        }

        if (currentSortDirection === 'asc') {
          return aVal - bVal;
        } else {
          return bVal - aVal;
        }
      });

      // Clear tbody
      tbody.innerHTML = '';

      // Re-add rows (without break rows for now - they only make sense in date order)
      dataRows.forEach(row => {
        tbody.appendChild(row);
      });

      // Update sort arrows
      document.querySelectorAll('.sort-arrow').forEach(arrow => {
        arrow.textContent = '';
      });

      const arrowSpan = document.getElementById('sort-' + column);
      if (arrowSpan) {
        arrowSpan.textContent = currentSortDirection === 'asc' ? ' ▲' : ' ▼';
      }
    }
  </script>
</body>
</html>
        `;

        return {
            statusCode: 200,
            headers: {
                ...getCorsHeaders('GET,OPTIONS'),
                'Content-Type': 'text/html'
            },
            body: html
        };
    } catch (e) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Server error' })
        };
    }
};

function escapeHtml(s) {
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
