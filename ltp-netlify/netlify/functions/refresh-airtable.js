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

    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Skip authentication for scheduled functions
    // For manual triggers, require superadmin authentication
    const isScheduled = event.headers['x-nf-event'] === 'schedule';

    if (!isScheduled) {
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
    }

    try {
        console.log('[Refresh Airtable] Starting student data refresh from Airtable...');

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

                    // Fetch mentor details if Mentor Assigned exists
                    let mentorName = null;
                    let mentorEmail = null;
                    const mentorId = Array.isArray(fields['Mentor Assigned'])
                        ? fields['Mentor Assigned'][0]
                        : fields['Mentor Assigned'] || null;

                    if (mentorId) {
                        try {
                            // Fetch mentor record from Staff table in Airtable
                            const mentorUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                                AIRTABLE_BASE_ID
                            )}/Staff/${encodeURIComponent(mentorId)}`;

                            const mentorRes = await fetch(mentorUrl, {
                                headers: {
                                    Authorization: `Bearer ${AIRTABLE_API_KEY}`
                                }
                            });

                            if (mentorRes.ok) {
                                const mentorRecord = await mentorRes.json();
                                const firstName = mentorRecord.fields?.['First Name'] || '';
                                const lastName = mentorRecord.fields?.['Last Name'] || '';
                                mentorName = `${firstName} ${lastName}`.trim() || null;
                                mentorEmail = mentorRecord.fields?.['Email'] || null;
                            }
                        } catch (mentorErr) {
                            console.warn(`Failed to fetch mentor ${mentorId}:`, mentorErr.message);
                        }
                    }

                    // Profile Picture is an attachment field - get the first image URL
                    const profilePictureArray = fields['Profile Picture'];
                    const profilePicture = (profilePictureArray && profilePictureArray.length > 0)
                        ? profilePictureArray[0].url
                        : null;

                    // Prepare update data
                    const updateData = {
                        studentName: fields['Student Name'] || student.studentName,
                        email: fields['Primary Email (from Contact)'] || student.email || null,
                        course: fields['Course Subject'] || null,
                        institution: fields['Enrolling Institution'] || null,
                        courseStartDate: fields['Course Start Date'] || null,
                        courseEndDate: fields['Course End Date'] || null,
                        courseExtDate: fields['Course Ext Date'] || null,
                        currentLevel: fields['Current Level'] || null,
                        profilePicture: profilePicture || student.profilePicture || null,
                        mentorId,
                        mentorName: mentorName || student.mentorName || null,
                        mentorEmail: mentorEmail || student.mentorEmail || null,
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
