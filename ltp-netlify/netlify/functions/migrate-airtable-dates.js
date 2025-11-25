// /.netlify/functions/migrate-airtable-dates
// ONE-TIME MIGRATION: Update existing student_pipeline records with correct Airtable dates and fields
// Run this once after deploying the new field mappings

const { getDb, createStudentPipelineIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
        };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        console.log('[Migration] Starting migration of Airtable dates and fields...');

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

        // Get all existing student records
        const existingStudents = await studentPipelineColl.find({}).toArray();
        console.log(`[Migration] Found ${existingStudents.length} existing records to migrate`);

        const stats = {
            total: existingStudents.length,
            updated: 0,
            skipped: 0,
            errors: []
        };

        // Process each existing student
        for (const student of existingStudents) {
            try {
                const recordId = student.airtable_record_id;

                if (!recordId) {
                    console.log(`[Migration] Skipping ${student.student_id}: No airtable_record_id`);
                    stats.skipped++;
                    continue;
                }

                // Fetch the Airtable record
                const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(AIRTABLE_ADMISSIONS_TABLE)}/${encodeURIComponent(recordId)}`;

                const response = await fetch(airtableUrl, {
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_API_KEY}`
                    }
                });

                if (!response.ok) {
                    throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
                }

                const record = await response.json();
                const fields = record.fields || {};

                // Extract correct field values
                const firstName = fields['First Name'] || '';
                const lastName = fields['Last Name'] || '';
                const name = `${firstName} ${lastName}`.trim() || student.name || 'Unknown';
                const email = fields['Primary Email (from Contact)'] || fields['Email'] || fields['Email Address'] || student.email;
                const leadSource = fields['UTM Source'] || fields['Lead Source'] || student.lead_source;
                const airtableCreatedDate = fields['Airtable Create Date'] || null;
                const airtableModifiedDate = fields['Last Modified (any field)'] || null;

                // Prepare updates
                const updates = {
                    name,
                    email,
                    lead_source: leadSource
                };

                // Update created_at if we have Airtable Create Date
                if (airtableCreatedDate) {
                    updates.created_at = new Date(airtableCreatedDate);
                    console.log(`[Migration] ${student.student_id}: Updating created_at from ${student.created_at} to ${airtableCreatedDate}`);
                }

                // Update updated_at if we have Last Modified date
                if (airtableModifiedDate) {
                    updates.updated_at = new Date(airtableModifiedDate);
                }

                // Update status history dates to use the correct created date
                if (airtableCreatedDate && student.admissions_status_history && student.admissions_status_history.length > 0) {
                    // Update the first entry in each status history to use Airtable created date
                    const createdDate = new Date(airtableCreatedDate);

                    if (student.admissions_status_history.length > 0 && student.admissions_status_history[0]) {
                        updates.admissions_status_history = [...student.admissions_status_history];
                        updates.admissions_status_history[0].date = createdDate;
                    }

                    if (student.foundations_status_history && student.foundations_status_history.length > 0) {
                        updates.foundations_status_history = [...student.foundations_status_history];
                        updates.foundations_status_history[0].date = createdDate;
                    }

                    if (student.new_student_status_history && student.new_student_status_history.length > 0) {
                        updates.new_student_status_history = [...student.new_student_status_history];
                        updates.new_student_status_history[0].date = createdDate;
                    }
                }

                // Perform the update
                await studentPipelineColl.updateOne(
                    { student_id: student.student_id },
                    { $set: updates }
                );

                stats.updated++;
                console.log(`[Migration] Updated: ${student.student_id} (${name})`);

            } catch (err) {
                console.error(`[Migration] Error processing ${student.student_id}:`, err);
                stats.errors.push({
                    studentId: student.student_id,
                    error: err.message
                });
            }
        }

        console.log('[Migration] Migration completed', stats);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Migration completed successfully',
                stats,
                note: 'This was a one-time migration. You can now delete this endpoint if desired.'
            })
        };

    } catch (err) {
        console.error('[Migration] Fatal error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Migration failed',
                details: err.message
            })
        };
    }
};
