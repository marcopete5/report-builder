// /.netlify/functions/report-weekly
// Weekly report with "Active days" and a drill-down modal per student.
const {
    getDb,
    createLessonEntryIndexes,
    createStudentIndexes
} = require('./utils/database');
const { getMockStudentData } = require('./utils/mock-data');
const { getCorsHeaders } = require('./utils/cors');
const { calculatePace } = require('./utils/pace-calculator');
const { requireAdmin } = require('./utils/db-auth');

function toCsv(rows) {
    const header = [
        'studentName',
        'studentId',
        'entries',
        'activeDays',
        'lastSeen',
        'lastLessonId',
        'lastLessonTitle'
    ];
    const out = [header.join(',')];
    for (const r of rows) {
        const vals = [
            (r.studentName ?? '').replaceAll('"', '""'),
            (r.studentId ?? '').replaceAll('"', '""'),
            String(r.entries ?? 0),
            String(r.activeDays ?? 0),
            r.lastSeen ? new Date(r.lastSeen).toISOString() : '',
            (r.lastLessonId ?? '').replaceAll('"', '""'),
            (r.lastLessonTitle ?? '').replaceAll('"', '""')
        ].map((v) => `"${v}"`);
        out.push(vals.join(','));
    }
    return out.join('\n');
}

function wantsHtml(event) {
    const q = event.queryStringParameters || {};
    if (String(q.view || '').toLowerCase() === 'html') return true;
    const accept = (event.headers && event.headers.accept) || '';
    return accept.includes('text/html');
}

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
        const daysParam = q.days || 'fullPeriod'; // Default to fullPeriod
        const days =
            daysParam === 'all' || daysParam === 'fullPeriod'
                ? daysParam
                : Math.max(1, Math.min(365, parseInt(daysParam, 10)));
        const formatRaw = q.format;
        const format = (formatRaw || '').toLowerCase();
        const courseFilter = q.course || null;
        const institutionFilter = q.institution || null;
        const activityFilter = q.activity || 'current'; // Default to 'current' instead of null
        // Support custom date range
        let since, until;
        const startDate = q.startDate;
        const endDate = q.endDate;
        const isFullPeriod = days === 'fullPeriod' && !startDate && !endDate;

        if (startDate && endDate) {
            // Custom date range - applies to all students
            since = new Date(startDate);
            until = new Date(endDate);
            until.setHours(23, 59, 59, 999); // Include the entire end day
        } else if (days === 'all') {
            since = new Date('2000-01-01'); // Far back date for "all time"
            until = new Date();
        } else if (isFullPeriod) {
            // Full period mode - each student will have their own date range
            // Set placeholder dates for now, will be calculated per student
            since = null;
            until = new Date();
        } else {
            since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            until = new Date();
        }

        const db = await getDb();
        await createLessonEntryIndexes(db);
        await createStudentIndexes(db);
        const coll = db.collection('lesson_entries');
        const studentsColl = db.collection('students');

        // Get ALL students from the database
        const allStudents = await studentsColl.find({}).toArray();

        let activityData = [];

        if (isFullPeriod) {
            // Full Period mode: calculate activity for each student from their courseStartDate to now
            for (const student of allStudents) {
                const studentStartDate = student.courseStartDate;
                if (!studentStartDate) {
                    // Skip students without a start date in fullPeriod mode
                    continue;
                }

                const studentSince = new Date(studentStartDate);
                const studentUntil = new Date();

                // Query submissions for this student in their enrollment period
                const submissions = await coll
                    .find({
                        studentId: student.studentId,
                        createdAt: { $gte: studentSince, $lte: studentUntil }
                    })
                    .sort({ createdAt: 1 })
                    .toArray();

                if (submissions.length === 0) {
                    // Student has no submissions in their enrollment period
                    continue;
                }

                // Calculate active days
                const activeDaysSet = new Set(
                    submissions.map((s) =>
                        s.createdAt.toISOString().slice(0, 10)
                    )
                );

                const lastSubmission = submissions[submissions.length - 1];

                activityData.push({
                    studentId: student.studentId,
                    studentName:
                        student.studentName || lastSubmission.studentName,
                    entries: submissions.length,
                    activeDays: activeDaysSet.size,
                    lastSeen: lastSubmission.createdAt,
                    lastLessonId: lastSubmission.lessonId,
                    lastLessonTitle: lastSubmission.lessonTitle
                });
            }
        } else {
            // Fixed date range mode: use aggregation pipeline
            const pipeline = [
                { $match: { createdAt: { $gte: since, $lte: until } } },
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
                { $sort: { createdAt: 1 } },
                {
                    $group: {
                        _id: {
                            studentId: '$studentId',
                            studentName: '$studentName'
                        },
                        entries: { $sum: 1 },
                        activeDaysSet: { $addToSet: '$_day' },
                        lastSeen: { $last: '$createdAt' },
                        lastLessonId: { $last: '$lessonId' },
                        lastLessonTitle: { $last: '$lessonTitle' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        studentId: '$_id.studentId',
                        studentName: '$_id.studentName',
                        entries: 1,
                        activeDays: { $size: '$activeDaysSet' },
                        lastSeen: 1,
                        lastLessonId: 1,
                        lastLessonTitle: 1
                    }
                },
                { $sort: { entries: -1, studentName: 1 } }
            ];

            activityData = await coll.aggregate(pipeline).toArray();
        }

        // Create a map of activity data by studentId
        const activityMap = new Map(activityData.map((a) => [a.studentId, a]));

        // Get last submission for all students (for those with no activity in range)
        const studentIdsWithNoActivity = allStudents
            .filter((s) => !activityMap.has(s.studentId))
            .map((s) => s.studentId);

        const lastSubmissions = await Promise.all(
            studentIdsWithNoActivity.map(async (studentId) => {
                const lastSub = await coll.findOne(
                    { studentId },
                    { sort: { createdAt: -1 } }
                );
                return { studentId, lastSub };
            })
        );

        const lastSubmissionMap = new Map(
            lastSubmissions.map((ls) => [ls.studentId, ls.lastSub])
        );

        // Build rows for ALL students, merging with activity data
        let rows = allStudents.map((student) => {
            const activity = activityMap.get(student.studentId);

            if (activity) {
                // Student has activity in the selected range
                return {
                    ...activity,
                    studentName: student.studentName || activity.studentName
                };
            } else {
                // Student has no activity in the selected range
                const lastSub = lastSubmissionMap.get(student.studentId);
                return {
                    studentId: student.studentId,
                    studentName: student.studentName || '(unknown)',
                    entries: 0,
                    activeDays: 0,
                    lastSeen: lastSub?.createdAt || null,
                    lastLessonId: lastSub?.lessonId || null,
                    lastLessonTitle: lastSub?.lessonTitle || null
                };
            }
        });

        // For "inactive" filter, find students who have EVER submitted but not in this range
        let inactiveStudents = [];
        if (activityFilter === 'inactive') {
            // Get ALL distinct students who have ever submitted
            const allStudentIds = await coll.distinct('studentId');

            // Get student IDs who have submissions in the selected range
            const activeStudentIds = new Set(rows.map((r) => r.studentId));

            // Find students who have submitted before but NOT in this range
            const inactiveStudentIds = allStudentIds.filter(
                (id) => !activeStudentIds.has(id)
            );

            // Get their last submission info
            for (const studentId of inactiveStudentIds) {
                const lastSub = await coll.findOne(
                    { studentId },
                    { sort: { createdAt: -1 } }
                );

                if (lastSub) {
                    inactiveStudents.push({
                        studentId: studentId,
                        studentName: lastSub.studentName || '(unknown)',
                        entries: 0,
                        activeDays: 0,
                        lastSeen: lastSub.createdAt,
                        lastLessonId: lastSub.lessonId,
                        lastLessonTitle: lastSub.lessonTitle
                    });
                }
            }
        }

        // Apply course, institution, or activity filter if specified
        if (courseFilter || institutionFilter || activityFilter) {
            try {
                // For inactive filter, use the inactive students list instead of active rows
                let studentsToFilter =
                    activityFilter === 'inactive' ? inactiveStudents : rows;

                // Get student IDs to query
                const studentIds = studentsToFilter
                    .map((r) => r.studentId)
                    .filter(Boolean);

                // Fetch student data from MongoDB
                const studentsData = await studentsColl
                    .find({ studentId: { $in: studentIds } })
                    .toArray();

                // Create a map for quick lookup
                const studentDataMap = new Map(
                    studentsData.map((s) => [
                        s.studentId,
                        {
                            course: s.course || '',
                            institution: s.institution || '',
                            courseEndDate: s.courseEndDate || null,
                            courseExtDate: s.courseExtDate || null
                        }
                    ])
                );

                // Filter students by course and/or institution and activity
                studentsToFilter = studentsToFilter.filter((r) => {
                    let studentData = studentDataMap.get(r.studentId);

                    // If not found in MongoDB, try mock data
                    if (!studentData) {
                        const mockData = getMockStudentData(r.studentId);
                        if (mockData) {
                            studentData = {
                                course: mockData.course || '',
                                institution: mockData.institution || '',
                                courseEndDate: mockData.endDate || null,
                                courseExtDate: null
                            };
                        } else {
                            return false;
                        }
                    }

                    let matchesCourse = true;
                    let matchesInstitution = true;
                    let matchesActivity = true;

                    if (courseFilter) {
                        matchesCourse = studentData.course
                            .toLowerCase()
                            .includes(courseFilter.toLowerCase());
                    }

                    if (institutionFilter) {
                        matchesInstitution = studentData.institution
                            .toLowerCase()
                            .includes(institutionFilter.toLowerCase());
                    }

                    if (activityFilter) {
                        const hasSubmissions = r.entries > 0;
                        const today = new Date();

                        // Determine if student is current based on Course End Date or Course Ext Date
                        let isCurrent = false;
                        const endDate =
                            studentData.courseExtDate ||
                            studentData.courseEndDate;
                        if (endDate) {
                            isCurrent = new Date(endDate) >= today;
                        }

                        if (activityFilter === 'active') {
                            matchesActivity = hasSubmissions;
                        } else if (activityFilter === 'inactive') {
                            matchesActivity = true; // Already filtered to inactive students
                        } else if (activityFilter === 'current') {
                            matchesActivity = isCurrent;
                        } else if (activityFilter === 'former') {
                            matchesActivity = !isCurrent && endDate !== null;
                        }
                    }

                    return (
                        matchesCourse && matchesInstitution && matchesActivity
                    );
                });

                // Update rows with filtered results
                rows = studentsToFilter;
            } catch (err) {
                // Silently continue without filtering on error
            }
        }

        // Add pace calculations to each row
        const lessonsCollection = db.collection('lessons');
        // Fetch ALL lessons for all courses instead of just Web Development
        const allCourseLessons = await lessonsCollection.find({}).toArray();

        // Batch fetch all student data from MongoDB (including profile pictures)
        const studentIds = rows.map((r) => r.studentId).filter(Boolean);
        const studentsData = await studentsColl
            .find({ studentId: { $in: studentIds } })
            .toArray();
        const studentsMap = new Map(studentsData.map((s) => [s.studentId, s]));

        // Add profile picture URL to each row
        rows = rows.map(row => {
            const studentDoc = studentsMap.get(row.studentId);
            return {
                ...row,
                profilePictureUrl: studentDoc?.profilePictureUrl || null
            };
        });

        for (const row of rows) {
            // Get all submitted lesson IDs for this student
            const submissions = await coll
                .find({ studentId: row.studentId })
                .toArray();
            const submittedLessonIds = submissions.map((s) => s.lessonId);

            // Get the student's course to filter lessons
            const studentDoc = studentsMap.get(row.studentId);
            const studentCourse = studentDoc?.course || 'Web Development';

            // Filter lessons for this student's specific course
            const courseLessons = allCourseLessons.filter(
                (lesson) => lesson.courseId === studentCourse
            );

            // Find current level (highest level with a submission) for ALL students
            if (courseLessons.length > 0 && submittedLessonIds.length > 0) {
                const sortedLessons = courseLessons.sort((a, b) => {
                    if (a.level !== b.level) return a.level - b.level;
                    if (a.sectionOrder !== b.sectionOrder)
                        return a.sectionOrder - b.sectionOrder;
                    return a.lessonOrder - b.lessonOrder;
                });
                const completedLessons = sortedLessons.filter((lesson) =>
                    submittedLessonIds.includes(lesson.lessonId)
                );
                if (completedLessons.length > 0) {
                    const currentLevel = Math.max(
                        ...completedLessons.map((l) => l.level || 0)
                    );
                    row.currentLevel = currentLevel;
                } else {
                    row.currentLevel = 0;
                }
            } else {
                row.currentLevel = null;
            }

            // Check for mock data or fetch from MongoDB students collection
            const mockData = getMockStudentData(row.studentId);
            let courseStartDate = null;
            let courseEndDate = null;

            if (mockData) {
                // Use name from mock data if available
                if (mockData.name) {
                    row.studentName = mockData.name;
                }
                courseStartDate = mockData.startDate;
                courseEndDate = mockData.endDate;
            } else {
                // Get from batch-fetched students data
                const studentDoc = studentsMap.get(row.studentId);
                if (studentDoc) {
                    courseStartDate = studentDoc.courseStartDate;
                    courseEndDate = studentDoc.courseEndDate;
                }
            }

            // Calculate pace if we have start/end dates
            if (courseStartDate && courseEndDate && courseLessons.length > 0) {
                const pace = calculatePace({
                    courseLessons,
                    submittedLessonIds,
                    courseStartDate: courseStartDate,
                    courseEndDate: courseEndDate
                });

                row.pace = pace.requiredDailyPace;
                row.paceStatus = pace.paceStatus;
            } else {
                row.pace = null;
                row.paceStatus = null;
            }
        }

        // Explicit formats first
        if (format === 'csv') {
            return {
                statusCode: 200,
                headers: {
                    ...getCorsHeaders('GET,OPTIONS'),
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Cache-Control': 'no-store'
                },
                body: toCsv(rows)
            };
        }
        if (format === 'json') {
            return {
                statusCode: 200,
                headers: {
                    ...getCorsHeaders('GET,OPTIONS'),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    windowDays: days,
                    since: since ? since.toISOString() : null,
                    count: rows.length,
                    rows
                })
            };
        }

        // HTML for browsers (or ?view=html)
        if (wantsHtml(event)) {
            const html = renderHtml({
                title: `Weekly Report (${
                    days === 'all'
                        ? 'All Time'
                        : days === 'fullPeriod'
                        ? 'Full Period'
                        : days + 'd'
                })`,
                days,
                rows,
                sinceIso: since ? since.toISOString() : null,
                untilIso: until.toISOString(),
                startDate,
                endDate,
                courseFilter,
                institutionFilter,
                activityFilter
            });
            return {
                statusCode: 200,
                headers: {
                    ...getCorsHeaders('GET,OPTIONS'),
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store'
                },
                body: html
            };
        }

        // Fallback JSON
        return {
            statusCode: 200,
            headers: {
                ...getCorsHeaders('GET,OPTIONS'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                windowDays: days,
                since: since ? since.toISOString() : null,
                count: rows.length,
                rows
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

function renderHtml({
    title,
    days,
    rows,
    sinceIso,
    untilIso,
    startDate,
    endDate,
    courseFilter,
    institutionFilter,
    activityFilter
}) {
    const labels = rows.map((r) => r.studentName || '(unknown)');
    const data = rows.map((r) => r.entries || 0);
    const safeRows = JSON.stringify(rows);
    const isCustomRange = !!(startDate && endDate);
    const displayRange = isCustomRange
        ? `${startDate} to ${endDate}`
        : days === 'all'
        ? 'All Time'
        : days === 'fullPeriod'
        ? 'Full Enrollment Period'
        : `last ${days} days`;

    // Build filter params string for reuse
    const filterParams = `${
        courseFilter ? `&course=${encodeURIComponent(courseFilter)}` : ''
    }${
        institutionFilter
            ? `&institution=${encodeURIComponent(institutionFilter)}`
            : ''
    }${
        activityFilter ? `&activity=${encodeURIComponent(activityFilter)}` : ''
    }`;

    return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/global.css">
<link rel="preconnect" href="https://cdn.jsdelivr.net" />
<style>
  :root { color-scheme: light; }
  body { font-family: var(--font-family-primary); font: 14px/1.45 var(--font-family-primary); margin: 0; color: #111827; background: #f9fafb; }
  .navbar { background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 0 2rem; display: flex; align-items: center; gap: 2rem; height: 64px; }
  .navbar-brand a { font-size: 1.5rem; font-weight: 600; color: #2d3748; text-decoration: none; }
  .navbar-brand a:hover { color: #4299e1; }
  .navbar-menu { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
  .navbar-item { padding: 0.5rem 1rem; color: #4a5568; text-decoration: none; font-size: 0.875rem; font-weight: 500; border-radius: 0.375rem; transition: all 0.2s; }
  .navbar-item:hover { background: #f7fafc; color: #4299e1; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin: 24px 24px 6px; }
  h1 { margin: 0; font-size: 20px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; color: #111827; }
  table { color: #111827; }
  th,
  td { border-color: #e5e7eb; color: #111827; }
  th { background: #f9fafb; }
  tr:hover { background: rgba(0,0,0,0.03); }
  .pill { color: #111827; border-color: #e5e7eb; background: #fff; }
  .pill.active { background: #111; color: #fff; border-color: #111; }
  .date-input { color: #111827; border-color: #e5e7eb; background: #fff; }
  .apply-btn { background: #111; color: #fff; border-color: #111; }
  .clear-btn { color: #111827; border-color: #e5e7eb; background: #fff; }
  .expand-btn { color: #111827; border-color: #e5e7eb; background: #fff; }
  .expand-btn:hover { background: #f3f4f6; }
  .muted { color: #6b7280; margin-bottom: 16px; }
  .modal { background: #fff; border-color: #e5e7eb; color: #111827; }
  .modal h3 { color: #111827; }
  .modal .muted { color: #6b7280; }
  .close { background: #f3f4f6; color: #111827; }
  .close:hover { background: #e5e7eb; }
  input::placeholder { color: #9ca3af; }
  .wrap { display: grid; gap: 20px; grid-template-columns: minmax(260px,1fr); margin: 0 24px; }
  .student:hover {color: #2563eb; cursor: pointer; text-decoration: underline;}
  .student-cell { display: flex; align-items: center; gap: 8px; }
  .student-profile-pic { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .student-profile-placeholder { width: 32px; height: 32px; border-radius: 50%; background: #cbd5e0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 16px; }
  @media (min-width: 900px) { .wrap { grid-template-columns: 1fr; } }
  canvas { width: 100%; height: 360px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th,td { padding:20px 8px; border-bottom:1px solid #e5e7eb; text-align:left; }
  th { cursor:pointer; user-select:none; position:sticky; top:0; background:inherit; }
  tr:hover { background: rgba(0,0,0,0.03); }
  .mono { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace; font-size:12px; }
  .controls { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
  .pill { border:1px solid #e5e7eb; border-radius:9999px; padding:6px 10px; background:transparent; cursor:pointer; text-decoration:none; color:inherit; }
  .pace-ahead { background: rgba(34, 197, 94, 0.15) !important; }
  .pace-on-pace { background: rgba(59, 130, 246, 0.15) !important; }
  .pace-behind { background: rgba(239, 68, 68, 0.15) !important; }
  .pace-dnf { background: rgba(156, 163, 175, 0.15) !important; }
  body.dark-mode .pace-ahead { background: rgba(34, 197, 94, 0.2) !important; }
  body.dark-mode .pace-on-pace { background: rgba(59, 130, 246, 0.2) !important; }
  body.dark-mode .pace-behind { background: rgba(239, 68, 68, 0.2) !important; }
  body.dark-mode .pace-dnf { background: rgba(156, 163, 175, 0.2) !important; }
  .pill.active { background:#111; color:#fff; border-color:#111; }
  .flex1 { flex: 1; }
  .date-input { padding:8px 10px; border:1px solid #e5e7eb; border-radius:8px; background:transparent; color:inherit; }
  .apply-btn { padding:8px 14px; border:1px solid #111; border-radius:8px; background:#111; color:#fff; cursor:pointer; }
  .clear-btn { padding:8px 14px; border:1px solid #e5e7eb; border-radius:8px; background:transparent; color:inherit; cursor:pointer; }
  .chart-container { position:relative; min-height:450px; margin-bottom:20px; }
  .chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
  .expand-btn { border:1px solid #e5e7eb; border-radius:8px; padding:8px 12px; background:transparent; cursor:pointer; font-size:13px; color:inherit; }
  .expand-btn:hover { background:#f3f4f6; }
  #detail-chart { height: 400px !important; width: 100% !important; }

  /* Fullscreen styles */
  .chart-fullscreen { position:fixed !important; inset:0; z-index:999999; background:#fff; padding:40px; display:none; }
  .chart-fullscreen.active { display:block; }
  .chart-fullscreen canvas { height:calc(100vh - 140px) !important; }
  .chart-fullscreen .expand-btn { position:absolute; top:20px; right:20px; }

  /* Modal */
  .backdrop { position:fixed; inset:0; background:rgba(0,0,0,.5); display:none; align-items:center; justify-content:center; }
  .modal { height: 90vh; max-width:760px; width:92%; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.25); color: #111827; }
  .modal h3 { margin:0 0 8px; color: #111827; }
  .close { border:0; background:#f3f4f6; color:#111827; padding:8px 12px; border-radius:8px; cursor:pointer; }
  .close:hover { background:#e5e7eb; }
  .modal .muted { color:#6b7280; margin:0 0 12px; }
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
  <div class="page-header">
    <h1>Student Pace — ${displayRange}</h1>
  </div>
  <div class="muted" style="margin: 0 24px 16px;">${
      sinceIso
          ? `${new Date(sinceIso).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            })} - ${new Date(untilIso).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            })}`
          : `Individual enrollment periods through ${new Date(
                untilIso
            ).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            })}`
  }

  <div class="wrap">
    <div class="card">
      <div class="controls">
        <span>Quick:</span>
        <a class="pill ${
            !isCustomRange && days === 'fullPeriod' ? 'active' : ''
        }" href="?view=html&days=fullPeriod${filterParams}">Full Period</a>
        <a class="pill ${
            !isCustomRange && days === 7 ? 'active' : ''
        }" href="?view=html&days=7${filterParams}">7d</a>
        <a class="pill ${
            !isCustomRange && days === 30 ? 'active' : ''
        }" href="?view=html&days=30${filterParams}">30d</a>
        <a class="pill ${
            !isCustomRange && days === 'all' ? 'active' : ''
        }" href="?view=html&days=all${filterParams}">All Time</a>
        <span class="flex1"></span>
        <label>Course:
          <select id="courseFilter" class="date-input" style="width:160px">
            <option value="">All Courses</option>
            <option value="Cybersecurity" ${
                courseFilter === 'Cybersecurity' ? 'selected' : ''
            }>Cybersecurity</option>
            <option value="Web Development" ${
                courseFilter === 'Web Development' ? 'selected' : ''
            }>Web Development</option>
          </select>
        </label>
        <label>Institution:
          <select id="institutionFilter" class="date-input" style="width:180px">
            <option value="">All Institutions</option>
            <option value="V School" ${
                institutionFilter === 'V School' ? 'selected' : ''
            }>V School</option>
            <option value="Millersville" ${
                institutionFilter === 'Millersville' ? 'selected' : ''
            }>Millersville University</option>
            <option value="TTU" ${
                institutionFilter === 'TTU' ? 'selected' : ''
            }>Texas Tech University</option>
            <option value="UVU" ${
                institutionFilter === 'UVU' ? 'selected' : ''
            }>Utah Valley University</option>
          </select>
        </label>
        <label>Student Status:
          <select id="activityFilter" class="date-input" style="width:160px">
            <option value="">All Students</option>
            <option value="current" ${
                activityFilter === 'current' ? 'selected' : ''
            }>Current</option>
            <option value="former" ${
                activityFilter === 'former' ? 'selected' : ''
            }>Former</option>
          </select>
        </label>
        <label>Start: <input type="date" id="startDate" class="date-input" value="${
            startDate || ''
        }" /></label>
        <label>End: <input type="date" id="endDate" class="date-input" value="${
            endDate || ''
        }" /></label>
        <button id="applyRange" class="apply-btn">Apply</button>
        ${
            isCustomRange
                ? '<button id="clearRange" class="clear-btn">Clear</button>'
                : ''
        }
        <a class="pill" href="?format=csv&days=${days}${
        startDate ? `&startDate=${startDate}&endDate=${endDate}` : ''
    }${filterParams}">Export CSV</a>
        <button class="pill" id="export-page-pdf">Export PDF</button>
      </div>
      <div class="controls">
        <span class="muted">Active days = distinct days with ≥1 submission</span>
      </div>
      <div class="controls">
        <strong>Students</strong>
        <span class="flex1"></span>
        <input id="filter" placeholder="Search by name, lesson, or ID…" style="padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;background:transparent;color:inherit" />
      </div>
      <div style="max-height: 60vh; overflow:auto;">
        <table id="tbl">
          <thead>
            <tr>
              <th data-k="studentName">Student</th>
              <th data-k="currentLevel">Level</th>
              <th data-k="entries">Entries</th>
              <th data-k="activeDays">Active days</th>
              <th data-k="lastSeen">Last seen</th>
              <th data-k="lastLessonTitle">Last lesson</th>
              <th data-k="pace">Pace (pts/day)</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="muted">Tip: click headers to sort · Click a student to open detail</div>
    </div>
  </div>

  <!-- Drill-down modal -->
  <div class="backdrop" id="detail-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <h3 id="detail-title" style="margin:0 0 4px;">Student detail</h3>
          <div class="muted" id="detail-subtitle"></div>
        </div>
        <button class="pill" id="view-page-btn">View Page</button>
      </div>

      <!-- Student info cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px;">
        <div style="padding:12px;background:rgba(37,99,235,0.1);border:1px solid rgba(37,99,235,0.3);border-radius:8px;">
          <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Attendance (Course Duration)</div>
          <div style="font-size:18px;font-weight:600;" id="detail-attendance">—</div>
        </div>
        <div style="padding:12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;">
          <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Story Points (Selected Range)</div>
          <div style="font-size:18px;font-weight:600;" id="detail-story-points">—</div>
        </div>
        <div style="padding:12px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);border-radius:8px;">
          <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Enrolled Course</div>
          <div style="font-size:14px;font-weight:500;" id="detail-course">—</div>
        </div>
        <div style="padding:12px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:8px;">
          <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Institution</div>
          <div style="font-size:14px;font-weight:500;" id="detail-institution">—</div>
        </div>
        <div style="padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;">
          <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Mentor</div>
          <div style="font-size:14px;font-weight:500;" id="detail-mentor">—</div>
        </div>
      </div>

      <!-- Pace Calculator -->
      <div id="pace-calculator" style="display:none;margin-bottom:20px;padding:16px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.2);border-radius:12px;">
        <h4 style="margin:0 0 12px;font-size:16px;">Pace Calculator</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:12px;">
          <div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Progress</div>
            <div style="font-size:16px;font-weight:600;" id="pace-progress">—</div>
          </div>
          <div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Required Pace</div>
            <div style="font-size:16px;font-weight:600;" id="pace-required">—</div>
          </div>
          <div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Actual Pace</div>
            <div style="font-size:16px;font-weight:600;" id="pace-actual">—</div>
          </div>
          <div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Days Remaining</div>
            <div style="font-size:16px;font-weight:600;" id="pace-days-remaining">—</div>
          </div>
        </div>
        <div style="padding:12px;border-radius:8px;margin-bottom:8px;" id="pace-status-card">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px;" id="pace-status-text">—</div>
          <div style="font-size:12px;" id="pace-status-detail">—</div>
        </div>
        <div style="font-size:12px;color:#6b7280;">
          <strong>Estimated Completion:</strong> <span id="pace-estimated-completion">—</span>
        </div>
      </div>

      <!-- Detail table -->
      <div style="max-height: 50vh; overflow:auto; margin-bottom:16px;">
        <table style="width:100%; border-collapse: collapse; font-size:13px;">
          <tbody id="detail-tbody"></tbody>
        </table>
      </div>

      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">
        <div style="display:flex;gap:8px">
          <button class="pill" id="export-detail-csv">Export CSV</button>
          <button class="pill" id="export-detail-pdf">Export PDF</button>
        </div>
        <button class="close" id="detail-close">Close</button>
      </div>
    </div>
  </div>

  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <!-- jsPDF for PDF export -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>

  <script>
    const ROWS = ${safeRows};
    const IS_CUSTOM_RANGE = ${isCustomRange};
    const START_DATE = ${startDate ? `'${startDate}'` : 'null'};
    const END_DATE = ${endDate ? `'${endDate}'` : 'null'};
    const DAYS = ${
        days === 'all' || days === 'fullPeriod' ? `'${days}'` : days
    };
    const COURSE_FILTER = ${courseFilter ? `'${courseFilter}'` : 'null'};
    const INSTITUTION_FILTER = ${
        institutionFilter ? `'${institutionFilter}'` : 'null'
    };
    const ACTIVITY_FILTER = ${activityFilter ? `'${activityFilter}'` : 'null'};

    // ---- Date Range Controls ----
    const applyBtn = document.getElementById('applyRange');
    const clearBtn = document.getElementById('clearRange');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const courseSelect = document.getElementById('courseFilter');
    const institutionSelect = document.getElementById('institutionFilter');
    const activitySelect = document.getElementById('activityFilter');

    applyBtn.addEventListener('click', () => {
      const start = startInput.value;
      const end = endInput.value;
      if (start && end) {
        const url = new URL(location.href);
        url.searchParams.set('view', 'html');
        url.searchParams.set('startDate', start);
        url.searchParams.set('endDate', end);
        url.searchParams.delete('days');
        if (courseSelect.value) {
          url.searchParams.set('course', courseSelect.value);
        }
        if (institutionSelect.value) {
          url.searchParams.set('institution', institutionSelect.value);
        }
        if (activitySelect.value) {
          url.searchParams.set('activity', activitySelect.value);
        }
        location.href = url.toString();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const url = new URL(location.href);
        url.searchParams.delete('startDate');
        url.searchParams.delete('endDate');
        url.searchParams.set('view', 'html');
        url.searchParams.set('days', 'fullPeriod');
        location.href = url.toString();
      });
    }

    // Course filter change
    courseSelect.addEventListener('change', () => {
      const url = new URL(location.href);
      if (courseSelect.value) {
        url.searchParams.set('course', courseSelect.value);
      } else {
        url.searchParams.delete('course');
      }
      location.href = url.toString();
    });

    // Institution filter change
    institutionSelect.addEventListener('change', () => {
      const url = new URL(location.href);
      if (institutionSelect.value) {
        url.searchParams.set('institution', institutionSelect.value);
      } else {
        url.searchParams.delete('institution');
      }
      location.href = url.toString();
    });

    // Activity filter change
    activitySelect.addEventListener('change', () => {
      const url = new URL(location.href);
      if (activitySelect.value) {
        url.searchParams.set('activity', activitySelect.value);
      } else {
        url.searchParams.delete('activity');
      }
      location.href = url.toString();
    });

    // ---- Summary Chart ----
    const ctx = document.getElementById('chart');
    const labels = ${JSON.stringify(labels)};
    const dataset = ${JSON.stringify(data)};
    const chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Entries', data: dataset }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { mode: 'index' } },
        scales: { x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 0 } }, y: { beginAtZero: true, precision: 0 } }
      }
    });

    // ---- Table + sort + filter + row click ----
    const tbody = document.querySelector('#tbl tbody');
    const filter = document.getElementById('filter');
    let view = ROWS.slice();
    let sortKey = 'entries';
    let sortDir = 'desc';

    function renderTable() {
      const rows = view.slice().sort((a,b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (sortKey === 'entries' || sortKey === 'activeDays' || sortKey === 'pace' || sortKey === 'currentLevel') return (sortDir==='desc'? (bv-av):(av-bv));
        if (sortKey === 'lastSeen') return (sortDir==='desc'? (new Date(bv)-new Date(av)):(new Date(av)-new Date(bv)));
        const A = (av||'').toString().toLowerCase(), B = (bv||'').toString().toLowerCase();
        return (sortDir==='desc'? (B.localeCompare(A)):(A.localeCompare(B)));
      });

      let html = '';
      for (const r of rows) {
        const paceClass = r.paceStatus ? 'pace-' + r.paceStatus : '';
        const paceDisplay = r.pace !== null && r.pace !== undefined ? r.pace : '—';
        const levelDisplay = r.currentLevel !== null && r.currentLevel !== undefined ? r.currentLevel : '—';
        const profilePicHtml = r.profilePictureUrl
          ? '<img src="' + r.profilePictureUrl + '" alt="' + escapeHtml(r.studentName||'') + '" class="student-profile-pic">'
          : '<div class="student-profile-placeholder">👤</div>';
        html += '<tr class="' + paceClass + '" data-id="'+(r.studentId||'')+'" data-name="'+escapeHtml(r.studentName||'')+'">'
          + '<td class="student"><div class="student-cell">' + profilePicHtml + '<span>' + escapeHtml(r.studentName||'') + '</span></div></td>'
          + '<td class="mono">' + levelDisplay + '</td>'
          + '<td class="mono">' + (r.entries ?? 0) + '</td>'
          + '<td class="mono">' + (r.activeDays ?? 0) + '</td>'
          + '<td class="mono">' + (r.lastSeen ? new Date(r.lastSeen).toLocaleString() : '') + '</td>'
          + '<td>' + escapeHtml(r.lastLessonTitle||'') + '</td>'
          + '<td class="mono">' + paceDisplay + '</td>'
          + '</tr>';
      }
      tbody.innerHTML = html;
    }

    document.querySelectorAll('#tbl th').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-k');
        if (sortKey === k) { sortDir = (sortDir==='asc'?'desc':'asc'); } else { sortKey = k; sortDir = 'desc'; }
        renderTable();
      });
    });

    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      if (!q) {
        view = ROWS.slice();
      } else {
        view = ROWS.filter(r => {
          const name = (r.studentName || '').toLowerCase();
          const lesson = (r.lastLessonTitle || '').toLowerCase();
          const id = (r.studentId || '').toLowerCase();
          return name.includes(q) || lesson.includes(q) || id.includes(q);
        });
      }
      renderTable();
    });

    // Drill-down handling
    const backdrop = document.getElementById('detail-backdrop');
    const closeBtn = document.getElementById('detail-close');
    const subtitle = document.getElementById('detail-subtitle');
    const detailTbody = document.getElementById('detail-tbody');

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const studentId = tr.getAttribute('data-id');
      const studentName = tr.getAttribute('data-name') || '(unknown)';
      if (!studentId) return;

      const rangeText = IS_CUSTOM_RANGE
        ? START_DATE + ' to ' + END_DATE
        : DAYS === 'fullPeriod'
        ? 'Full Enrollment Period'
        : DAYS === 'all'
        ? 'All Time'
        : 'last ' + DAYS + ' days';
      subtitle.textContent = studentName + ' — ' + rangeText;
      await openDetail(studentId, studentName);
    });

    const closeModal = () => {
      backdrop.style.display = 'none';
    };

    closeBtn.addEventListener('click', closeModal);

    // Close on backdrop click (outside modal)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Store current detail data for exports
    let currentDetailData = null;
    let currentStudentName = '';
    let currentStudentId = '';

    async function openDetail(studentId, studentName) {
      currentStudentId = studentId;
      currentStudentName = studentName;
      let endpoint = '/.netlify/functions/report-student?studentId=' + encodeURIComponent(studentId) + '&format=json';

      if (IS_CUSTOM_RANGE && START_DATE && END_DATE) {
        // Custom date range - apply to this student
        endpoint += '&startDate=' + encodeURIComponent(START_DATE) + '&endDate=' + encodeURIComponent(END_DATE);
      } else if (DAYS === 'fullPeriod') {
        // Full period mode - let report-student use the student's full enrollment period
        // Don't pass days parameter, report-student will default to full enrollment period
        endpoint += '&days=all';
      } else {
        // Fixed days mode (7d, 30d, all)
        endpoint += '&days=' + encodeURIComponent(DAYS);
      }

      const res = await fetch(endpoint);
      const data = await res.json();
      currentDetailData = data;

      // Use course-based attendance if available, otherwise fall back to selected range
      let attendanceText = '—';
      if (data?.courseAttendance) {
        const ca = data.courseAttendance;
        attendanceText = ca.daysWithSubmissions + ' / ' + ca.totalCourseDays + ' days (' + ca.attendancePercent + '%)';
      } else {
        // Fallback: calculate for selected range if no course dates
        const daysWithSubmissions = data.series ? data.series.filter(d => d.count > 0).length : 0;
        const totalDaysInRange = data.series ? data.series.length : 0;
        const attendancePercent = totalDaysInRange > 0 ? ((daysWithSubmissions / totalDaysInRange) * 100).toFixed(1) : 0;
        attendanceText = daysWithSubmissions + ' / ' + totalDaysInRange + ' days (' + attendancePercent + '%)';
      }

      // Populate info cards
      document.getElementById('detail-attendance').textContent = attendanceText;
      // Use actual story points if available, otherwise fall back to submission count
      const storyPointsValue = data?.pace?.completedStoryPoints ?? data?.totalEntries ?? 0;
      document.getElementById('detail-story-points').textContent = String(storyPointsValue) + ' points';
      document.getElementById('detail-course').textContent = data?.enrolledCourse || '—';
      document.getElementById('detail-institution').textContent = data?.enrollingInstitution || '—';
      document.getElementById('detail-mentor').textContent = data?.mentorName || '—';

      // Populate pace calculator
      const paceCalculator = document.getElementById('pace-calculator');
      if (data?.pace) {
        const p = data.pace;
        paceCalculator.style.display = 'block';

        document.getElementById('pace-progress').textContent = p.completedStoryPoints + ' / ' + p.totalStoryPoints + ' pts (' + p.progressPercentage + '%)';
        document.getElementById('pace-required').textContent = p.requiredDailyPace + ' pts/day';
        document.getElementById('pace-actual').textContent = p.actualDailyPace + ' pts/day';
        document.getElementById('pace-days-remaining').textContent = p.daysRemaining + ' days';

        // Set status card styling and text based on pace status
        const statusCard = document.getElementById('pace-status-card');
        const statusText = document.getElementById('pace-status-text');
        const statusDetail = document.getElementById('pace-status-detail');

        if (p.paceStatus === 'ahead') {
          statusCard.style.background = 'rgba(16,185,129,0.1)';
          statusCard.style.border = '1px solid rgba(16,185,129,0.3)';
          statusText.style.color = '#059669';
          statusText.textContent = '✓ Ahead of Pace';
          statusDetail.textContent = Math.abs(p.pacePercentage) + '% ahead of schedule';
        } else if (p.paceStatus === 'behind') {
          statusCard.style.background = 'rgba(239,68,68,0.1)';
          statusCard.style.border = '1px solid rgba(239,68,68,0.3)';
          statusText.style.color = '#dc2626';
          statusText.textContent = '⚠ Behind Pace';
          statusDetail.textContent = Math.abs(p.pacePercentage) + '% behind schedule';
        } else {
          statusCard.style.background = 'rgba(59,130,246,0.1)';
          statusCard.style.border = '1px solid rgba(59,130,246,0.3)';
          statusText.style.color = '#2563eb';
          statusText.textContent = '→ On Pace';
          statusDetail.textContent = 'Within 10% of expected progress';
        }

        // Format estimated completion date
        if (p.estimatedCompletionDate === 'DNF') {
          document.getElementById('pace-estimated-completion').textContent = 'DNF (Did Not Finish)';
          document.getElementById('pace-estimated-completion').style.color = '#dc2626';
          document.getElementById('pace-estimated-completion').style.fontWeight = '600';
        } else if (p.estimatedCompletionDate) {
          const estDate = new Date(p.estimatedCompletionDate);
          const courseEndDate = data.endDate ? new Date(data.endDate) : null;
          let dateText = estDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

          if (courseEndDate) {
            if (estDate <= courseEndDate) {
              dateText += ' (on time)';
            } else {
              const daysLate = Math.ceil((estDate - courseEndDate) / (1000 * 60 * 60 * 24));
              dateText += ' (' + daysLate + ' days late)';
            }
          }

          document.getElementById('pace-estimated-completion').textContent = dateText;
          document.getElementById('pace-estimated-completion').style.color = '';
          document.getElementById('pace-estimated-completion').style.fontWeight = '';
        } else {
          document.getElementById('pace-estimated-completion').textContent = 'Unable to estimate';
          document.getElementById('pace-estimated-completion').style.color = '';
          document.getElementById('pace-estimated-completion').style.fontWeight = '';
        }
      } else {
        paceCalculator.style.display = 'none';
      }

      // Fill details table
      const rangeLabel = data?.totals?.rangeLabel || 'last 7 days';
      const rows = [
        ['Total submissions', String(data?.totals?.totalSubmissions ?? 0)],
        ['Submissions (' + rangeLabel + ')', String(data?.totals?.rangeSubmissions ?? 0)],
        ['Last submission', data?.lastSubmission?.at ? new Date(data.lastSubmission.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Last lesson', escapeHtml(data?.lastSubmission?.lessonTitle || '—')],
        ['Start date', data?.startDate ? new Date(data.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['End date', data?.endDate ? new Date(data.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
      ];

      // Add Current Location section if data is available
      if (data?.currentLocation) {
        rows.push(['', '']); // Spacer
        rows.push(['Current Lesson', escapeHtml(data.currentLocation.currentLesson || '—')]);
        rows.push(['Current Level', data.currentLocation.currentLevel ? 'Level ' + data.currentLocation.currentLevel : '—']);
        rows.push(['Current Section', escapeHtml(data.currentLocation.currentSection || '—')]);
        rows.push(['Furthest Progress', escapeHtml(data.currentLocation.furthestProgress || '—')]);
      }

      let html = '';
      for (const [k,v] of rows) {
        if (k === '' && v === '') {
          // Spacer row
          html += '<tr><td colspan="2" style="height:8px;border:none;"></td></tr>';
        } else {
          html += '<tr><td class="muted" style="width:190px;">'+escapeHtml(k)+'</td><td class="mono">'+v+'</td></tr>';
        }
      }
      detailTbody.innerHTML = html;

      backdrop.style.display = 'flex';
    }

    // View Page button - navigate to dedicated student page
    document.getElementById('view-page-btn').addEventListener('click', () => {
      if (!currentStudentId) return;

      const url = new URL('/.netlify/functions/student-page', location.origin);
      url.searchParams.set('studentId', currentStudentId);
      url.searchParams.set('studentName', currentStudentName);

      if (IS_CUSTOM_RANGE && START_DATE && END_DATE) {
        url.searchParams.set('startDate', START_DATE);
        url.searchParams.set('endDate', END_DATE);
      } else if (DAYS === 'fullPeriod') {
        // Full period mode - use 'all' for student page
        url.searchParams.set('days', 'all');
      } else {
        url.searchParams.set('days', DAYS);
      }

      window.location.href = url.toString();
    });

    renderTable();

    function escapeHtml(s) {
      return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
    }

    // ---- Export Functions ----

    // Export student detail as CSV
    document.getElementById('export-detail-csv').addEventListener('click', () => {
      if (!currentDetailData) return;

      const rangeLabel = currentDetailData?.totals?.rangeLabel || 'last 7 days';
      const rows = [
        ['Student Name', currentStudentName],
        ['Total Submissions', currentDetailData?.totals?.totalSubmissions ?? 0],
        ['Submissions (' + rangeLabel + ')', currentDetailData?.totals?.rangeSubmissions ?? 0],
        ['Last Submission', currentDetailData?.lastSubmission?.at ? new Date(currentDetailData.lastSubmission.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Start Date', currentDetailData?.startDate ? new Date(currentDetailData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['End Date', currentDetailData?.endDate ? new Date(currentDetailData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Enrolled Course', currentDetailData?.enrolledCourse || '—'],
        ['Mentor', currentDetailData?.mentorName || '—'],
        [''],
        ['Daily Submissions'],
        ['Date', 'Count']
      ];

      (currentDetailData.series || []).forEach(d => {
        rows.push([d.date, d.count]);
      });

      const csv = rows.map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentStudentName.replace(/[^a-zA-Z0-9]/g, '_') + '_detail.csv';
      a.click();
      URL.revokeObjectURL(url);
    });

    // Export student detail as PDF
    document.getElementById('export-detail-pdf').addEventListener('click', () => {
      if (!currentDetailData) return;
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      doc.setFontSize(18);
      doc.text('Student Detail: ' + currentStudentName, 14, 20);

      const rangeLabel = currentDetailData?.totals?.rangeLabel || 'last 7 days';
      const tableData = [
        ['Total Submissions', String(currentDetailData?.totals?.totalSubmissions ?? 0)],
        ['Submissions (' + rangeLabel + ')', String(currentDetailData?.totals?.rangeSubmissions ?? 0)],
        ['Last Submission', currentDetailData?.lastSubmission?.at ? new Date(currentDetailData.lastSubmission.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Start Date', currentDetailData?.startDate ? new Date(currentDetailData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['End Date', currentDetailData?.endDate ? new Date(currentDetailData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'],
        ['Enrolled Course', currentDetailData?.enrolledCourse || '—'],
        ['Mentor', currentDetailData?.mentorName || '—']
      ];

      doc.autoTable({
        head: [['Field', 'Value']],
        body: tableData,
        startY: 30,
        theme: 'grid'
      });

      const dailyData = (currentDetailData.series || []).map(d => [d.date, String(d.count)]);
      doc.autoTable({
        head: [['Date', 'Submissions']],
        body: dailyData,
        startY: doc.lastAutoTable.finalY + 10,
        theme: 'striped'
      });

      doc.save(currentStudentName.replace(/[^a-zA-Z0-9]/g, '_') + '_detail.pdf');
    });

    // Export main page as PDF
    document.getElementById('export-page-pdf').addEventListener('click', () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      const rangeText = IS_CUSTOM_RANGE
        ? START_DATE + ' to ' + END_DATE
        : DAYS === 'fullPeriod'
        ? 'Full Enrollment Period'
        : DAYS === 'all'
        ? 'All Time'
        : 'last ' + DAYS + ' days';
      doc.setFontSize(18);
      doc.text('Student Pace Report', 14, 20);
      doc.setFontSize(12);
      doc.text(rangeText, 14, 28);

      const tableData = view.map(r => [
        r.studentName || '(unknown)',
        String(r.entries ?? 0),
        String(r.activeDays ?? 0),
        r.lastSeen ? new Date(r.lastSeen).toLocaleString() : '',
        r.lastLessonTitle || ''
      ]);

      doc.autoTable({
        head: [['Student', 'Entries', 'Active Days', 'Last Seen', 'Last Lesson']],
        body: tableData,
        startY: 35,
        theme: 'striped',
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 50 },
          3: { cellWidth: 40 },
          4: { cellWidth: 50 }
        }
      });

      const filename = 'student_pace_' + (IS_CUSTOM_RANGE ? START_DATE + '_to_' + END_DATE : DAYS + 'd') + '.pdf';
      doc.save(filename);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
