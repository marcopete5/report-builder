// /.netlify/functions/dashboard-admissions
// Admissions Dashboard - Shows lead funnel, conversion metrics, and counselor performance
// Admin only access

const { getDb, createStudentPipelineIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const db = await getDb();
        await createStudentPipelineIndexes(db);

        const studentPipelineColl = db.collection('student_pipeline');

        // Get all students for calculations
        let allStudents = await studentPipelineColl.find({}).toArray();

        // Parse filter parameters
        const queryParams = event.queryStringParameters || {};
        const filterMode = queryParams.filterMode || 'created'; // 'created' or 'snapshot'
        const filterType = queryParams.filterType || 'month'; // 'month' or 'range'

        let startDate, endDate;

        // Calculate date range based on filter type
        if (filterType === 'month') {
            const month = parseInt(queryParams.month || new Date().getMonth() + 1);
            const year = parseInt(queryParams.year || new Date().getFullYear());
            startDate = new Date(year, month - 1, 1); // First day of month
            endDate = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month
        } else if (filterType === 'range') {
            startDate = queryParams.startDate ? new Date(queryParams.startDate) : null;
            endDate = queryParams.endDate ? new Date(queryParams.endDate + 'T23:59:59.999Z') : null;
        }

        // Store students created in date range for Total Leads calculation
        let studentsCreatedInRange = allStudents;

        // Apply date filter
        if (startDate && endDate) {
            const now = new Date();

            if (filterMode === 'created') {
                // Created Date mode:
                // - For Total Leads: count students created in date range (up to now)
                const effectiveEndDate = endDate > now ? now : endDate;
                studentsCreatedInRange = allStudents.filter(s =>
                    s.created_at &&
                    new Date(s.created_at) >= startDate &&
                    new Date(s.created_at) <= effectiveEndDate
                );

                // For status metrics:
                // - If endDate is in the PAST: reconstruct historical status
                // - If endDate is in the PRESENT/FUTURE: use current status (no reconstruction needed)
                if (endDate <= now) {
                    // Historical date - reconstruct status from history
                    allStudents = reconstructSnapshotStatus(allStudents, endDate);
                } else {
                    // Current/future date - use current status directly, just filter by existence
                    allStudents = allStudents.filter(s =>
                        s.created_at && new Date(s.created_at) <= now
                    );
                }
            } else if (filterMode === 'snapshot') {
                // Snapshot mode: always reconstruct status at endDate
                const effectiveEndDate = endDate > now ? now : endDate;
                allStudents = reconstructSnapshotStatus(allStudents, effectiveEndDate);
                studentsCreatedInRange = allStudents; // Use same set for Total Leads
            }
        }

        // Compute final status for each student based on precedence rules
        allStudents = allStudents.map(s => ({
            ...s,
            computed_status: getComputedStatus(s)
        }));

        // Also compute status for studentsCreatedInRange (needed for New Lead metric)
        studentsCreatedInRange = studentsCreatedInRange.map(s => ({
            ...s,
            computed_status: getComputedStatus(s)
        }));

        // Calculate overview metrics
        // State-based metrics: Rolling totals from allStudents
        // Event-based metrics: Subsets from studentsCreatedInRange (New Leads pool)

        // NEW LEADS - Event-based: all students created in date range
        const newLeads = studentsCreatedInRange.length;
        const newLeadsNames = studentsCreatedInRange.map(s => s.name).sort();

        // FOUNDATIONS SENT - State-based: rolling total of all students in this status
        const foundationsSentStudents = allStudents.filter(
            s => s.computed_status === 'Foundations Sent'
        );
        const foundationsSent = foundationsSentStudents.length;
        const foundationsSentNames = foundationsSentStudents.map(s => s.name).sort();

        // FOUNDATIONS IN PROGRESS - State-based: rolling total of all students in this status
        const foundationsInProgressStudents = allStudents.filter(
            s => s.computed_status === 'Foundations In Progress'
        );
        const foundationsInProgress = foundationsInProgressStudents.length;
        const foundationsInProgressNames = foundationsInProgressStudents.map(s => s.name).sort();

        // FOUNDATIONS COMPLETED - State-based: rolling total of all students in this status
        const foundationsCompletedStudents = allStudents.filter(
            s => s.computed_status === 'Foundations Completed'
        );
        const foundationsCompleted = foundationsCompletedStudents.length;
        const foundationsCompletedNames = foundationsCompletedStudents.map(s => s.name).sort();

        // PENDING APPROVAL - State-based: rolling total of all students in this status
        const pendingApprovalStudents = allStudents.filter(
            s => s.computed_status === 'Pending Approval'
        );
        const pendingApproval = pendingApprovalStudents.length;
        const pendingApprovalNames = pendingApprovalStudents.map(s => s.name).sort();

        // REGISTERED STUDENTS - State-based: rolling total of all students in this status
        const registeredStudentsFiltered = allStudents.filter(
            s => s.computed_status === 'Registered Students'
        );
        const registeredStudents = registeredStudentsFiltered.length;
        const registeredStudentsNames = registeredStudentsFiltered.map(s => s.name).sort();

        // ENROLLED STUDENTS - State-based: rolling total of all students in this status
        const enrolledStudentsFiltered = allStudents.filter(
            s => s.computed_status === 'Enrolled Students'
        );
        const enrolledStudents = enrolledStudentsFiltered.length;
        const enrolledStudentsNames = enrolledStudentsFiltered.map(s => s.name).sort();

        // NO START/FOUNDATIONS FAILED - Event-based: subset of new leads pool
        const noStartFoundationsFailedFiltered = studentsCreatedInRange.filter(
            s => s.computed_status === 'No Start/Withdrawn'
        );
        const noStartFoundationsFailed = noStartFoundationsFailedFiltered.length;
        const noStartFoundationsFailedNames = noStartFoundationsFailedFiltered.map(s => s.name).sort();

        // LEADS LOST / WITHDRAWN - Event-based: subset of new leads pool
        const leadsLostWithdrawnFiltered = studentsCreatedInRange.filter(
            s => s.computed_status === 'Leads Lost / Withdrawn'
        );
        const leadsLostWithdrawn = leadsLostWithdrawnFiltered.length;
        const leadsLostWithdrawnNames = leadsLostWithdrawnFiltered.map(s => s.name).sort();

        // Get current date for calculations
        const now = new Date();

        // Calculate conversion funnel - all percentages relative to original new leads
        // Note: Using CURRENT status since status history isn't being maintained properly

        // Column 1: All new leads who have reached Foundations "In Progress" or beyond
        // (In Progress, Stalled, Needs Retake, Complete)
        const funnelFoundationsInProgressStudents = studentsCreatedInRange.filter(s => {
            const status = s.current_foundations_status;
            if (!status) return false;
            const statusLower = status.toLowerCase();
            return statusLower.includes('in progress') ||
                   statusLower.includes('stalled') ||
                   statusLower.includes('needs retake') ||
                   statusLower.includes('complete');
        });
        const leadsReachedFoundationsInProgress = funnelFoundationsInProgressStudents.length;
        const foundationsInProgressPercent = newLeads > 0 ? (leadsReachedFoundationsInProgress / newLeads) * 100 : 0;
        const funnelFoundationsInProgressNames = funnelFoundationsInProgressStudents.map(s => s.name).sort();

        // Column 2: All new leads who have reached Foundations "Complete"
        const funnelFoundationsCompletedStudents = studentsCreatedInRange.filter(s => {
            const status = s.current_foundations_status;
            if (!status) return false;
            return status.toLowerCase().includes('complete');
        });
        const leadsReachedFoundationsCompleted = funnelFoundationsCompletedStudents.length;
        const foundationsCompletedPercent = newLeads > 0 ? (leadsReachedFoundationsCompleted / newLeads) * 100 : 0;
        const funnelFoundationsCompletedNames = funnelFoundationsCompletedStudents.map(s => s.name).sort();

        // Column 3: All new leads who have reached Admissions "Registered" or beyond
        const funnelRegisteredStudents = studentsCreatedInRange.filter(s => {
            const status = s.current_admissions_status;
            if (!status) return false;
            const statusLower = status.toLowerCase();
            return statusLower.includes('registered') ||
                   statusLower.includes('started');
        });
        const leadsReachedRegistered = funnelRegisteredStudents.length;
        const registeredPercent = newLeads > 0 ? (leadsReachedRegistered / newLeads) * 100 : 0;
        const funnelRegisteredNames = funnelRegisteredStudents.map(s => s.name).sort();

        // Column 4: All new leads who are currently enrolled
        // - Admissions Status = "Started"
        // - New Student Status contains "In Progress"
        // - Course Start Date in the past
        const funnelEnrolledStudents = studentsCreatedInRange.filter(s => {
            const admissionsStatus = s.current_admissions_status;
            const newStudentStatus = s.current_new_student_status;

            const hasStartedStatus = admissionsStatus && admissionsStatus.toLowerCase().includes('started');
            const hasInProgressStatus = newStudentStatus && newStudentStatus.toLowerCase().includes('in progress');
            const courseStartInPast = s.course_start_date && new Date(s.course_start_date) <= now;

            return hasStartedStatus && hasInProgressStatus && courseStartInPast;
        });
        const leadsReachedEnrolled = funnelEnrolledStudents.length;
        const enrolledPercent = newLeads > 0 ? (leadsReachedEnrolled / newLeads) * 100 : 0;
        const funnelEnrolledNames = funnelEnrolledStudents.map(s => s.name).sort();

        // Enrollment by program (use computed status)
        const programCounts = {};
        allStudents.forEach(s => {
            if (s.computed_status === 'Enrolled Students' && s.program) {
                programCounts[s.program] = (programCounts[s.program] || 0) + 1;
            }
        });
        const enrollmentByProgram = Object.entries(programCounts).map(([program, count]) => ({
            program,
            count
        }));

        // Lead sources
        const sourceCounts = {};
        const sourceConverted = {};
        allStudents.forEach(s => {
            if (s.lead_source) {
                sourceCounts[s.lead_source] = (sourceCounts[s.lead_source] || 0) + 1;
                if (s.enrollment_date) {
                    sourceConverted[s.lead_source] = (sourceConverted[s.lead_source] || 0) + 1;
                }
            }
        });
        const leadSources = Object.entries(sourceCounts).map(([source, count]) => ({
            source,
            count,
            converted: sourceConverted[source] || 0
        }));

        // Weekly trends (last 8 weeks)
        const weeklyTrends = [];
        for (let i = 7; i >= 0; i--) {
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - (i * 7));
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);

            const newLeadsThisWeek = allStudents.filter(s =>
                s.created_at && new Date(s.created_at) >= weekStart && new Date(s.created_at) < weekEnd
            ).length;

            const enrolledThisWeek = allStudents.filter(s =>
                s.enrollment_date && new Date(s.enrollment_date) >= weekStart && new Date(s.enrollment_date) < weekEnd
            ).length;

            weeklyTrends.push({
                week: `Week ${8 - i}`,
                newLeads: newLeadsThisWeek,
                enrolled: enrolledThisWeek
            });
        }

        const dashboardData = {
            overview: {
                newLeads,
                newLeadsNames,
                foundationsSent,
                foundationsSentNames,
                foundationsInProgress,
                foundationsInProgressNames,
                foundationsCompleted,
                foundationsCompletedNames,
                pendingApproval,
                pendingApprovalNames,
                registeredStudents,
                registeredStudentsNames,
                enrolledStudents,
                enrolledStudentsNames,
                noStartFoundationsFailed,
                noStartFoundationsFailedNames,
                leadsLostWithdrawn,
                leadsLostWithdrawnNames,
                lastUpdated: new Date().toISOString()
            },

            conversions: {
                leadToFoundationsInProgress: parseFloat(foundationsInProgressPercent.toFixed(1)),
                foundationsCompleted: parseFloat(foundationsCompletedPercent.toFixed(1)),
                registered: parseFloat(registeredPercent.toFixed(1)),
                enrolled: parseFloat(enrolledPercent.toFixed(1)),
                // Student counts and names for each stage
                counts: {
                    leadToFoundationsInProgress: leadsReachedFoundationsInProgress,
                    foundationsCompleted: leadsReachedFoundationsCompleted,
                    registered: leadsReachedRegistered,
                    enrolled: leadsReachedEnrolled
                },
                names: {
                    leadToFoundationsInProgress: funnelFoundationsInProgressNames,
                    foundationsCompleted: funnelFoundationsCompletedNames,
                    registered: funnelRegisteredNames,
                    enrolled: funnelEnrolledNames
                }
            },

            enrollmentByProgram,

            // Start dates - upcoming course starts
            startDates: calculateStartDates(allStudents),

            // Financial status breakdown
            financialStatus: calculateFinancialStatus(allStudents),

            // Counselor performance metrics
            counselors: calculateCounselorPerformance(allStudents),

            weeklyTrends,
            leadSources,

            // Status breakdown
            statusBreakdown: [
                { status: 'New Leads', count: newLeads },
                { status: 'Foundations Sent', count: foundationsSent },
                { status: 'Foundations In Progress', count: foundationsInProgress },
                { status: 'Foundations Completed', count: foundationsCompleted },
                { status: 'Pending Approval', count: pendingApproval },
                { status: 'Registered Students', count: registeredStudents },
                { status: 'Enrolled Students', count: enrolledStudents },
                { status: 'No Start/Foundations Failed', count: noStartFoundationsFailed },
                { status: 'Leads Lost / Withdrawn', count: leadsLostWithdrawn }
            ]
        };

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(dashboardData)
        };
    } catch (err) {
        console.error('Error in dashboard-admissions:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};

/**
 * Calculate upcoming start dates from student records
 * @param {Array} students - All students
 * @returns {Array} - Start dates with counts
 */
function calculateStartDates(students) {
    const now = new Date();
    const threeMonthsFromNow = new Date(now);
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    // Get students with upcoming start dates
    const upcomingStarts = students.filter(s =>
        s.course_start_date &&
        new Date(s.course_start_date) >= now &&
        new Date(s.course_start_date) <= threeMonthsFromNow
    );

    // Group by date
    const dateCounts = {};
    upcomingStarts.forEach(s => {
        const dateStr = new Date(s.course_start_date).toISOString().split('T')[0];
        dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
    });

    // Convert to array and sort by date
    return Object.entries(dateCounts)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Calculate financial status breakdown
 * @param {Array} students - All students
 * @returns {Object} - Financial status counts
 */
function calculateFinancialStatus(students) {
    const enrolled = students.filter(s =>
        s.computed_status === 'Enrolled Students' ||
        s.computed_status === 'Registered Students'
    );

    let civilian = 0;
    let giBill = 0;
    let both = 0;

    enrolled.forEach(s => {
        const civilianCompleted = s.finance_status_civilian === 'Completed';
        const giBillCompleted = s.finance_status_gi_bill === 'Completed';

        if (civilianCompleted && giBillCompleted) {
            both++;
        } else if (civilianCompleted) {
            civilian++;
        } else if (giBillCompleted) {
            giBill++;
        }
        // If neither is completed, don't count them in any category
    });

    return { civilian, giBill, both };
}

/**
 * Calculate counselor performance metrics
 * @param {Array} students - All students
 * @returns {Array} - Counselor performance data
 */
function calculateCounselorPerformance(students) {
    const counselorData = {};

    students.forEach(s => {
        const counselor = s.admissions_rep || 'Unassigned';

        if (!counselorData[counselor]) {
            counselorData[counselor] = {
                name: counselor,
                leadsAssigned: 0,
                contacted24hrs: 0,
                enrolled: 0,
                totalDaysToEnrollment: 0,
                enrollmentCount: 0
            };
        }

        const data = counselorData[counselor];
        data.leadsAssigned++;

        // Check if contacted within 24 hours
        if (s.first_contact_date && s.created_at) {
            const timeDiff = new Date(s.first_contact_date) - new Date(s.created_at);
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            if (hoursDiff <= 24) {
                data.contacted24hrs++;
            }
        }

        // Check if enrolled
        if (s.enrollment_date) {
            data.enrolled++;

            // Calculate days to enrollment
            if (s.created_at) {
                const daysToEnrollment = Math.floor(
                    (new Date(s.enrollment_date) - new Date(s.created_at)) / (1000 * 60 * 60 * 24)
                );
                data.totalDaysToEnrollment += daysToEnrollment;
                data.enrollmentCount++;
            }
        }
    });

    // Convert to array and calculate rates
    return Object.values(counselorData)
        .map(data => ({
            name: data.name,
            leadsAssigned: data.leadsAssigned,
            contacted24hrs: data.contacted24hrs,
            contactRate: data.leadsAssigned > 0 ? (data.contacted24hrs / data.leadsAssigned) * 100 : 0,
            enrolled: data.enrolled,
            conversionRate: data.leadsAssigned > 0 ? (data.enrolled / data.leadsAssigned) * 100 : 0,
            avgDaysToEnrollment: data.enrollmentCount > 0 ? Math.round(data.totalDaysToEnrollment / data.enrollmentCount) : 0
        }))
        .filter(c => c.name !== 'Unassigned' || c.leadsAssigned > 0) // Include unassigned only if there are leads
        .sort((a, b) => b.enrolled - a.enrolled); // Sort by enrollment count (highest first)
}

/**
 * Get the computed final status for a student based on precedence rules
 * @param {Object} student - Student object with current statuses
 * @returns {String} - The computed final status
 */
function getComputedStatus(student) {
    const admissionsStatus = student.current_admissions_status;
    const foundationsStatus = student.current_foundations_status;
    const courseStartDate = student.course_start_date ? new Date(student.course_start_date) : null;
    const courseEndDate = student.course_end_date ? new Date(student.course_end_date) : null;
    const courseExtDate = student.course_ext_date ? new Date(student.course_ext_date) : null;
    const now = new Date();

    // 1. Leads Lost/Withdrawn (highest priority - only from New Leads pool)
    // Must be lost AND haven't started foundations yet
    if (['Lost', 'Not Viable', 'Cold'].includes(admissionsStatus) &&
        (!foundationsStatus || foundationsStatus === 'Not Started')) {
        return 'Leads Lost / Withdrawn';
    }

    // 2. No Start/Withdrawn
    // This covers students who progressed past new lead stage but didn't complete
    if (admissionsStatus === 'No Start' || ['Failed', 'Incomplete'].includes(foundationsStatus)) {
        return 'No Start/Withdrawn';
    }

    // 3. Enrolled Students
    // Admissions = Started AND Course Start Date in past AND (Course End Date OR Course Ext Date in future) AND New Student Status contains "In Progress"
    if (admissionsStatus === 'Started') {
        const startedInPast = courseStartDate && courseStartDate <= now;
        const endInFuture = (courseEndDate && courseEndDate >= now) || (courseExtDate && courseExtDate >= now);
        const newStudentStatus = student.current_new_student_status;
        const hasInProgressStatus = newStudentStatus && newStudentStatus.includes('In Progress');

        if (startedInPast && endInFuture && hasInProgressStatus) {
            return 'Enrolled Students';
        }
    }

    // 4. Registered Students
    if (admissionsStatus === 'Registered') {
        return 'Registered Students';
    }

    // 5. Pending Approval
    if (admissionsStatus === 'Pending Approval') {
        return 'Pending Approval';
    }

    // 6. Foundations Completed
    if (foundationsStatus === 'Complete') {
        return 'Foundations Completed';
    }

    // 7. Foundations In Progress
    if (['In Progress', 'Stalled', 'Needs Retake'].includes(foundationsStatus)) {
        return 'Foundations In Progress';
    }

    // 8. Foundations Sent
    if (foundationsStatus === 'Sent') {
        return 'Foundations Sent';
    }

    // 9. New Lead (default for everyone else)
    return 'New Lead';
}

/**
 * Reconstruct student statuses at a specific point in time
 * @param {Array} students - All students
 * @param {Date} snapshotDate - The date to reconstruct status for
 * @returns {Array} - Students with reconstructed statuses
 */
function reconstructSnapshotStatus(students, snapshotDate) {
    return students
        .filter(s => {
            // Only include students that existed at the snapshot date
            return s.created_at && new Date(s.created_at) <= snapshotDate;
        })
        .map(s => {
            // Create a copy of the student object
            const snapshotStudent = { ...s };

            // Reconstruct admissions status at snapshot date
            snapshotStudent.current_admissions_status = getStatusAtDate(
                s.admissions_status_history,
                snapshotDate
            );

            // Reconstruct foundations status at snapshot date
            snapshotStudent.current_foundations_status = getStatusAtDate(
                s.foundations_status_history,
                snapshotDate
            );

            // Reconstruct new student status at snapshot date
            snapshotStudent.current_new_student_status = getStatusAtDate(
                s.new_student_status_history,
                snapshotDate
            );

            // Check if milestone dates had occurred by the snapshot date
            snapshotStudent.first_contact_date =
                s.first_contact_date && new Date(s.first_contact_date) <= snapshotDate
                ? s.first_contact_date : null;

            snapshotStudent.foundations_completed_date =
                s.foundations_completed_date && new Date(s.foundations_completed_date) <= snapshotDate
                ? s.foundations_completed_date : null;

            snapshotStudent.registered_date =
                s.registered_date && new Date(s.registered_date) <= snapshotDate
                ? s.registered_date : null;

            snapshotStudent.enrollment_date =
                s.enrollment_date && new Date(s.enrollment_date) <= snapshotDate
                ? s.enrollment_date : null;

            snapshotStudent.dropped_date =
                s.dropped_date && new Date(s.dropped_date) <= snapshotDate
                ? s.dropped_date : null;

            return snapshotStudent;
        });
}

/**
 * Get the status that was active at a specific date from status history
 * @param {Array} statusHistory - Array of {status, date} objects
 * @param {Date} targetDate - The date to check
 * @returns {String|null} - The status at that date
 */
function getStatusAtDate(statusHistory, targetDate) {
    if (!statusHistory || statusHistory.length === 0) {
        return null;
    }

    // Sort history by date (oldest first)
    const sorted = [...statusHistory].sort((a, b) =>
        new Date(a.date) - new Date(b.date)
    );

    // Find the last status that occurred on or before the target date
    let activeStatus = null;
    for (const entry of sorted) {
        if (new Date(entry.date) <= targetDate) {
            activeStatus = entry.status;
        } else {
            break;
        }
    }

    return activeStatus;
}

/**
 * Check if a student has ever been in a specific status
 * @param {Array} statusHistory - Array of {status, date} objects
 * @param {String} targetStatus - The status to check for
 * @returns {Boolean} - True if student has ever been in this status
 */
function hasEverBeenInStatus(statusHistory, targetStatus) {
    if (!statusHistory || statusHistory.length === 0) {
        return false;
    }

    return statusHistory.some(entry => entry.status === targetStatus);
}

/**
 * Check if a student has ever been in a status that contains a specific string
 * @param {Array} statusHistory - Array of {status, date} objects
 * @param {String} searchString - The string to search for in status values
 * @returns {Boolean} - True if student has ever been in a status containing this string
 */
function hasEverBeenInStatusContaining(statusHistory, searchString) {
    if (!statusHistory || statusHistory.length === 0) {
        return false;
    }

    return statusHistory.some(entry =>
        entry.status && entry.status.includes(searchString)
    );
}
