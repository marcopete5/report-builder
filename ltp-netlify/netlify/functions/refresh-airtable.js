// /.netlify/functions/refresh-airtable
// Refresh all student data from Airtable
// Only accessible by superadmins

const { getDb, createStudentIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { getUserFromEvent } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Require authentication
    const user = getUserFromEvent(event);
    if (!user) {
        return {
            statusCode: 401,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Authentication required' })
        };
    }

    // Check if user is superadmin
    if (user.role !== 'superadmin') {
        return {
            statusCode: 403,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Only superadmins can refresh Airtable data' })
        };
    }

    try {
        const {
            AIRTABLE_API_KEY,
            AIRTABLE_BASE_ID,
            AIRTABLE_TABLE = 'Students'
        } = process.env;

        if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Airtable credentials not configured' })
            };
        }

        const db = await getDb();
        await createStudentIndexes(db);

        const studentsColl = db.collection('students');

        // Get all students
        const allStudents = await studentsColl.find({}).toArray();

        if (allStudents.length === 0) {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'No students found to refresh',
                    total: 0,
                    updated: 0,
                    failed: 0
                })
            };
        }

        const updatedStudents = [];
        const failedStudents = [];
        const skippedStudents = [];

        for (const student of allStudents) {
            if (!student.studentId) {
                skippedStudents.push({
                    studentName: student.studentName || 'Unknown',
                    reason: 'No studentId'
                });
                continue;
            }

            try {
                const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                    AIRTABLE_BASE_ID
                )}/${encodeURIComponent(AIRTABLE_TABLE)}/${encodeURIComponent(student.studentId)}`;

                const airtableRes = await fetch(airtableUrl, {
                    headers: {
                        Authorization: `Bearer ${AIRTABLE_API_KEY}`
                    }
                });

                if (airtableRes.ok) {
                    const record = await airtableRes.json();
                    const fields = record.fields || {};

                    // Prepare update data
                    const updateData = {
                        studentName: fields['Student Name'] || student.studentName,
                        course: fields['Course Subject'] || null,
                        institution: fields['Enrolling Institution'] || null,
                        courseStartDate: fields['Course Start Date'] || null,
                        courseEndDate: fields['Course End Date'] || null,
                        courseExtDate: fields['Course Ext Date'] || null,
                        mentorId: Array.isArray(fields['Mentor Assigned'])
                            ? fields['Mentor Assigned'][0]
                            : fields['Mentor Assigned'] || null,
                        lastSyncedAt: new Date()
                    };

                    // Update the student record
                    await studentsColl.updateOne(
                        { studentId: student.studentId },
                        { $set: updateData }
                    );

                    updatedStudents.push({
                        studentId: student.studentId,
                        studentName: updateData.studentName
                    });
                } else if (airtableRes.status === 404) {
                    // Student not found in Airtable
                    skippedStudents.push({
                        studentId: student.studentId,
                        studentName: student.studentName || 'Unknown',
                        reason: 'Not found in Airtable'
                    });
                } else {
                    // Other Airtable error
                    failedStudents.push({
                        studentId: student.studentId,
                        studentName: student.studentName || 'Unknown',
                        error: `Airtable returned status ${airtableRes.status}`
                    });
                }
            } catch (err) {
                failedStudents.push({
                    studentId: student.studentId,
                    studentName: student.studentName || 'Unknown',
                    error: err.message
                });
            }
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Airtable refresh completed',
                total: allStudents.length,
                updated: updatedStudents.length,
                failed: failedStudents.length,
                skipped: skippedStudents.length,
                updatedStudents,
                failedStudents,
                skippedStudents
            })
        };
    } catch (err) {
        console.error('Error refreshing Airtable data:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
