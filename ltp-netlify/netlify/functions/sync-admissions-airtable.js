// /.netlify/functions/sync-admissions-airtable
// Sync student pipeline data from Airtable to MongoDB
// Tracks status changes and maintains history

const { getDb, createStudentPipelineIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { getUserFromEvent } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Skip authentication for scheduled functions
    // For manual triggers, require admin authentication
    const isScheduled = event.headers['x-nf-event'] === 'schedule';

    if (!isScheduled) {
        const user = getUserFromEvent(event);
        if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Admin access required' })
            };
        }
    }

    try {
        console.log('[Admissions Sync] Starting Airtable sync...');

        const {
            AIRTABLE_API_KEY,
            AIRTABLE_BASE_ID,
            AIRTABLE_ADMISSIONS_TABLE = 'Student Records'
        } = process.env;

        if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Airtable credentials not configured' })
            };
        }

        const db = await getDb();
        await createStudentPipelineIndexes(db);

        const studentPipelineColl = db.collection('student_pipeline');

        // Fetch all records from Airtable
        const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(AIRTABLE_ADMISSIONS_TABLE)}`;

        let allRecords = [];
        let offset = null;

        // Paginate through all Airtable records
        do {
            const url = offset ? `${airtableUrl}?offset=${offset}` : airtableUrl;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_API_KEY}`
                }
            });

            if (!response.ok) {
                throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            allRecords = allRecords.concat(data.records || []);
            offset = data.offset;
        } while (offset);

        console.log(`[Admissions Sync] Fetched ${allRecords.length} records from Airtable`);

        const stats = {
            total: allRecords.length,
            created: 0,
            updated: 0,
            unchanged: 0,
            errors: []
        };

        // Process each Airtable record
        for (const record of allRecords) {
            try {
                const fields = record.fields || {};
                const recordId = record.id;

                // Extract data from Airtable fields
                const studentId = fields['Student ID'] || recordId;
                const firstName = fields['First Name'] || '';
                const lastName = fields['Last Name'] || '';
                const name = `${firstName} ${lastName}`.trim() || 'Unknown';
                const email = fields['Primary Email (from Contact)'] || fields['Email'] || fields['Email Address'] || null;
                const program = fields['Program Selection'] || fields['Program'] || fields['Course Subject'] || null;
                const leadSource = fields['UTM Source'] || fields['Lead Source'] || null;

                // Extract current statuses
                const admissionsStatus = fields['Admissions Status'] || null;
                const foundationsStatus = fields['Foundations Status'] || null;
                const newStudentStatus = fields['New Student Status'] || null;

                // Extract additional fields for dashboard features
                const admissionsRep = fields['Admissions Rep'] || null;
                const financeStatusCivilian = fields['Finance Status (Civilian)'] || null;
                const financeStatusGIBill = fields['Finance Status (GI Bill)'] || null;
                const financeStatus = fields['Finance Status'] || null;
                const courseStartDate = fields['Course Start Date'] || fields['Start Date'] || null;
                const courseEndDate = fields['Course End Date'] || null;
                const courseExtDate = fields['Course Ext Date'] || null;
                const firstContactDate = fields['First Contact'] || null;
                const enrollingInstitution = fields['Enrolling Institution'] || null;
                const veteranStatus = fields['Veteran Status'] || null;
                const utmSource = fields['UTM Source'] || null;
                const utmMedium = fields['UTM Medium'] || null;

                // Extract Airtable metadata fields
                const airtableCreatedDate = fields['Airtable Create Date'] || null;
                const airtableModifiedDate = fields['Last Modified (any field)'] || null;

                // Check if student exists
                const existingStudent = await studentPipelineColl.findOne({ student_id: studentId });

                const now = new Date();

                if (!existingStudent) {
                    // Create new student record
                    const recordCreatedDate = airtableCreatedDate ? new Date(airtableCreatedDate) : now;
                    const recordModifiedDate = airtableModifiedDate ? new Date(airtableModifiedDate) : now;

                    const newStudent = {
                        student_id: studentId,
                        airtable_record_id: recordId,
                        name,
                        email,
                        program,
                        lead_source: leadSource,

                        // Current statuses
                        current_admissions_status: admissionsStatus,
                        current_foundations_status: foundationsStatus,
                        current_new_student_status: newStudentStatus,

                        // Initialize status history arrays (use Airtable created date for initial status)
                        admissions_status_history: admissionsStatus ? [{ status: admissionsStatus, date: recordCreatedDate }] : [],
                        foundations_status_history: foundationsStatus ? [{ status: foundationsStatus, date: recordCreatedDate }] : [],
                        new_student_status_history: newStudentStatus ? [{ status: newStudentStatus, date: recordCreatedDate }] : [],

                        // Additional fields for dashboard features
                        admissions_rep: admissionsRep,
                        finance_status_civilian: financeStatusCivilian,
                        finance_status_gi_bill: financeStatusGIBill,
                        finance_status: financeStatus,
                        course_start_date: courseStartDate ? new Date(courseStartDate) : null,
                        course_end_date: courseEndDate ? new Date(courseEndDate) : null,
                        course_ext_date: courseExtDate ? new Date(courseExtDate) : null,
                        first_contact_date: firstContactDate ? new Date(firstContactDate) : null,
                        enrolling_institution: enrollingInstitution,
                        veteran_status: veteranStatus,
                        utm_source: utmSource,
                        utm_medium: utmMedium,

                        // Initialize milestone dates (will be calculated below)
                        foundations_completed_date: null,
                        registered_date: null,
                        enrollment_date: null,
                        dropped_date: null,

                        created_at: recordCreatedDate,
                        updated_at: recordModifiedDate
                    };

                    // Set initial milestone dates
                    updateMilestoneDates(newStudent);

                    await studentPipelineColl.insertOne(newStudent);
                    stats.created++;
                    console.log(`[Admissions Sync] Created student: ${studentId} (${name})`);
                } else {
                    // Update existing student
                    const recordModifiedDate = airtableModifiedDate ? new Date(airtableModifiedDate) : now;

                    const updates = {
                        name,
                        email,
                        program,
                        lead_source: leadSource,
                        airtable_record_id: recordId,
                        admissions_rep: admissionsRep,
                        finance_status_civilian: financeStatusCivilian,
                        finance_status_gi_bill: financeStatusGIBill,
                        finance_status: financeStatus,
                        course_start_date: courseStartDate ? new Date(courseStartDate) : null,
                        course_end_date: courseEndDate ? new Date(courseEndDate) : null,
                        course_ext_date: courseExtDate ? new Date(courseExtDate) : null,
                        enrolling_institution: enrollingInstitution,
                        veteran_status: veteranStatus,
                        utm_source: utmSource,
                        utm_medium: utmMedium,
                        updated_at: recordModifiedDate
                    };

                    // Only update first_contact_date if it's coming from Airtable AND doesn't exist in DB
                    if (firstContactDate && !existingStudent.first_contact_date) {
                        updates.first_contact_date = new Date(firstContactDate);
                    }

                    let hasChanges = false;

                    // Check and update Admissions Status
                    if (admissionsStatus && admissionsStatus !== existingStudent.current_admissions_status) {
                        updates.current_admissions_status = admissionsStatus;
                        updates.admissions_status_history = [
                            ...(existingStudent.admissions_status_history || []),
                            { status: admissionsStatus, date: now }
                        ];
                        hasChanges = true;
                        console.log(`[Admissions Sync] ${studentId}: Admissions status changed to ${admissionsStatus}`);
                    }

                    // Check and update Foundations Status
                    if (foundationsStatus && foundationsStatus !== existingStudent.current_foundations_status) {
                        updates.current_foundations_status = foundationsStatus;
                        updates.foundations_status_history = [
                            ...(existingStudent.foundations_status_history || []),
                            { status: foundationsStatus, date: now }
                        ];
                        hasChanges = true;
                        console.log(`[Admissions Sync] ${studentId}: Foundations status changed to ${foundationsStatus}`);
                    }

                    // Check and update New Student Status
                    if (newStudentStatus && newStudentStatus !== existingStudent.current_new_student_status) {
                        updates.current_new_student_status = newStudentStatus;
                        updates.new_student_status_history = [
                            ...(existingStudent.new_student_status_history || []),
                            { status: newStudentStatus, date: now }
                        ];
                        hasChanges = true;
                        console.log(`[Admissions Sync] ${studentId}: New student status changed to ${newStudentStatus}`);
                    }

                    // Check if other fields have changed
                    const dateChanged = (newDate, oldDate) => {
                        if (!newDate) return false;
                        if (!oldDate) return true;
                        return new Date(newDate).getTime() !== new Date(oldDate).getTime();
                    };

                    if (admissionsRep !== existingStudent.admissions_rep ||
                        financeStatusCivilian !== existingStudent.finance_status_civilian ||
                        financeStatusGIBill !== existingStudent.finance_status_gi_bill ||
                        financeStatus !== existingStudent.finance_status ||
                        enrollingInstitution !== existingStudent.enrolling_institution ||
                        veteranStatus !== existingStudent.veteran_status ||
                        utmSource !== existingStudent.utm_source ||
                        utmMedium !== existingStudent.utm_medium ||
                        name !== existingStudent.name ||
                        email !== existingStudent.email ||
                        program !== existingStudent.program ||
                        leadSource !== existingStudent.lead_source ||
                        dateChanged(courseStartDate, existingStudent.course_start_date) ||
                        dateChanged(courseEndDate, existingStudent.course_end_date) ||
                        dateChanged(courseExtDate, existingStudent.course_ext_date)) {
                        hasChanges = true;
                    }

                    // Update milestone dates based on current statuses
                    const milestonesUpdated = updateMilestoneDates({ ...existingStudent, ...updates });
                    if (milestonesUpdated) {
                        Object.assign(updates, milestonesUpdated);
                        hasChanges = true;
                    }

                    if (hasChanges) {
                        await studentPipelineColl.updateOne(
                            { student_id: studentId },
                            { $set: updates }
                        );
                        stats.updated++;
                        console.log(`[Admissions Sync] Updated student: ${studentId}`);
                    } else {
                        stats.unchanged++;
                    }
                }
            } catch (err) {
                console.error(`[Admissions Sync] Error processing record ${record.id}:`, err);
                stats.errors.push({
                    recordId: record.id,
                    error: err.message
                });
            }
        }

        console.log('[Admissions Sync] Sync completed', stats);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Airtable sync completed successfully',
                stats
            })
        };
    } catch (err) {
        console.error('[Admissions Sync] Fatal error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Sync failed',
                details: err.message
            })
        };
    }
};

/**
 * Update milestone dates based on current statuses
 * @param {Object} student - Student record with current statuses
 * @returns {Object|null} - Object with milestone date updates, or null if no updates
 */
function updateMilestoneDates(student) {
    const updates = {};
    let hasUpdates = false;

    // First Contact Date (when status moves beyond "Need to Contact")
    if (!student.first_contact_date &&
        student.current_admissions_status &&
        student.current_admissions_status !== 'Need to Contact') {
        updates.first_contact_date = new Date();
        hasUpdates = true;
    }

    // Foundations Completed Date (handle both "Complete" and "Completed")
    if (!student.foundations_completed_date &&
        (student.current_foundations_status === 'Completed' ||
         student.current_foundations_status === 'Complete')) {
        updates.foundations_completed_date = new Date();
        hasUpdates = true;
    }

    // Registered Date
    if (!student.registered_date &&
        student.current_admissions_status === 'Registered') {
        updates.registered_date = new Date();
        hasUpdates = true;
    }

    // Enrollment Date (Started)
    if (!student.enrollment_date &&
        student.current_admissions_status === 'Started') {
        updates.enrollment_date = new Date();
        hasUpdates = true;
    }

    // Dropped Date
    if (!student.dropped_date &&
        (student.current_admissions_status === 'Lost' ||
         (student.current_new_student_status && student.current_new_student_status.includes('Dropped')))) {
        updates.dropped_date = new Date();
        hasUpdates = true;
    }

    return hasUpdates ? updates : null;
}
