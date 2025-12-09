// /.netlify/functions/sync-students
// Sync students from lesson_entries to students collection
// Ensures every student who has submitted lessons exists in the students collection

const { getDb, createStudentIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');

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

    try {
        console.log('[Sync Students] Starting student sync from lesson_entries...');
        const db = await getDb();
        await createStudentIndexes(db);

        const lessonEntriesColl = db.collection('lesson_entries');
        const studentsColl = db.collection('students');

        // Get all unique students from lesson_entries
        const studentsFromEntries = await lessonEntriesColl.aggregate([
            {
                $group: {
                    _id: '$studentId',
                    studentName: { $first: '$studentName' },
                    firstSubmission: { $min: '$createdAt' },
                    lastSubmission: { $max: '$createdAt' }
                }
            },
            {
                $project: {
                    _id: 0,
                    studentId: '$_id',
                    studentName: 1,
                    firstSubmission: 1,
                    lastSubmission: 1
                }
            }
        ]).toArray();

        // Get existing student IDs from students collection
        const existingStudentIds = new Set(
            (await studentsColl.find({}).toArray()).map(s => s.studentId)
        );

        // Find students that exist in lesson_entries but not in students collection
        const missingStudents = studentsFromEntries.filter(
            s => !existingStudentIds.has(s.studentId)
        );

        if (missingStudents.length === 0) {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'All students are already synced',
                    totalStudentsInEntries: studentsFromEntries.length,
                    totalStudentsInCollection: existingStudentIds.size,
                    missing: 0
                })
            };
        }

        // Sync missing students with Airtable data (if available)
        const {
            AIRTABLE_API_KEY,
            AIRTABLE_BASE_ID,
            AIRTABLE_TABLE = 'Students'
        } = process.env;

        const syncedStudents = [];
        const failedStudents = [];

        for (const student of missingStudents) {
            try {
                let airtableData = {
                    studentName: student.studentName,
                    course: null,
                    institution: null,
                    courseStartDate: null,
                    courseEndDate: null,
                    courseExtDate: null,
                    mentorId: null
                };

                // Try to fetch from Airtable
                if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID && student.studentId) {
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

                            airtableData = {
                                studentName: fields['Student Name'] || student.studentName,
                                course: fields['Course Subject'] || null,
                                institution: fields['Enrolling Institution'] || null,
                                courseStartDate: fields['Course Start Date'] || null,
                                courseEndDate: fields['Course End Date'] || null,
                                courseExtDate: fields['Course Ext Date'] || null,
                                mentorId: fields['Mentor Assigned'] || null
                            };
                        }
                    } catch (airtableErr) {
                        // Continue with basic data if Airtable fetch fails
                    }
                }

                // Insert student record
                await studentsColl.insertOne({
                    studentId: student.studentId,
                    ...airtableData,
                    createdAt: student.firstSubmission,
                    lastSubmissionAt: student.lastSubmission,
                    lastSyncedAt: new Date()
                });

                syncedStudents.push({
                    studentId: student.studentId,
                    studentName: airtableData.studentName
                });
            } catch (err) {
                failedStudents.push({
                    studentId: student.studentId,
                    studentName: student.studentName,
                    error: err.message
                });
            }
        }

        console.log('[Sync Students] Sync completed', {
            totalStudentsInEntries: studentsFromEntries.length,
            totalStudentsInCollection: existingStudentIds.size,
            missing: missingStudents.length,
            synced: syncedStudents.length,
            failed: failedStudents.length
        });

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Student sync completed',
                totalStudentsInEntries: studentsFromEntries.length,
                totalStudentsInCollection: existingStudentIds.size,
                missing: missingStudents.length,
                synced: syncedStudents.length,
                failed: failedStudents.length,
                syncedStudents,
                failedStudents
            })
        };
    } catch (err) {
        console.error('[Sync Students] Fatal error:', err);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};
