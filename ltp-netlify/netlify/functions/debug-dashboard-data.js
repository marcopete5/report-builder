// /.netlify/functions/debug-dashboard-data
// Debug endpoint to see actual student data and status history

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

        // Get all students
        const allStudents = await studentPipelineColl.find({}).toArray();

        // Get students in "Foundations Completed" status
        const foundationsCompleted = allStudents.filter(
            s => s.current_foundations_status === 'Completed' || s.current_foundations_status === 'Complete'
        );

        // Get detailed info for each
        const debugData = {
            totalStudents: allStudents.length,
            foundationsCompletedCount: foundationsCompleted.length,
            foundationsCompletedDetails: foundationsCompleted.map(s => ({
                name: s.name,
                student_id: s.student_id,
                current_foundations_status: s.current_foundations_status,
                created_at: s.created_at,
                updated_at: s.updated_at,
                foundations_status_history: s.foundations_status_history,
                admissions_status_history: s.admissions_status_history,
                airtable_record_id: s.airtable_record_id
            })),
            allFoundationsStatuses: allStudents.reduce((acc, s) => {
                const status = s.current_foundations_status || 'null';
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, {})
        };

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(debugData, null, 2)
        };

    } catch (err) {
        console.error('[Debug] Error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: err.message, stack: err.stack })
        };
    }
};
