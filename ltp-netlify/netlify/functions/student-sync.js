// /.netlify/functions/student-sync
// Syncs student data from Airtable to MongoDB students collection
// Call with ?secret=SEED_SECRET to backfill or refresh student data

const { getDb, createStudentIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS')
        return { statusCode: 204, headers: getCorsHeaders('GET,OPTIONS'), body: '' };
    if (event.httpMethod !== 'GET')
        return {
            statusCode: 405,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    try {
        const q = event.queryStringParameters || {};
        const secret = q.secret;

        // Security check
        if (secret !== process.env.SEED_SECRET) {
            return {
                statusCode: 403,
                headers: getCorsHeaders('GET,OPTIONS'),
                body: JSON.stringify({ error: 'Forbidden - invalid secret' })
            };
        }

        const {
            AIRTABLE_API_KEY,
            AIRTABLE_BASE_ID,
            AIRTABLE_TABLE = 'Students'
        } = process.env;

        if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
            return {
                statusCode: 500,
                headers: getCorsHeaders('GET,OPTIONS'),
                body: JSON.stringify({ error: 'Airtable credentials missing' })
            };
        }

        const db = await getDb();
        await createStudentIndexes(db);

        const studentsColl = db.collection('students');
        const entriesColl = db.collection('lesson_entries');

        // Get all unique student IDs from lesson_entries
        const studentIdsFromDB = await entriesColl.distinct('studentId');

        let syncedCount = 0;
        let errorCount = 0;
        const errors = [];

        // Batch process students
        for (let i = 0; i < studentIdsFromDB.length; i += 10) {
            const batch = studentIdsFromDB.slice(i, i + 10);

            for (const studentId of batch) {
                try {
                    // Get last submission for this student
                    const lastSubmission = await entriesColl.findOne(
                        { studentId },
                        { sort: { createdAt: -1 } }
                    );

                    // Fetch from Airtable
                    const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                        AIRTABLE_BASE_ID
                    )}/${encodeURIComponent(AIRTABLE_TABLE)}/${encodeURIComponent(studentId)}`;

                    const airtableRes = await fetch(airtableUrl, {
                        headers: {
                            Authorization: `Bearer ${AIRTABLE_API_KEY}`
                        }
                    });

                    let airtableData = {};
                    if (airtableRes.ok) {
                        const record = await airtableRes.json();
                        const fields = record.fields || {};

                        airtableData = {
                            studentName: fields['Student Name'] || lastSubmission?.studentName || '(unknown)',
                            course: fields['Course Subject'] || lastSubmission?.courseId || null,
                            institution: fields['Enrolling Institution'] || null,
                            courseStartDate: fields['Course Start Date'] || null,
                            courseEndDate: fields['Course End Date'] || null,
                            courseExtDate: fields['Course Ext Date'] || null,
                            mentorId: fields['Mentor Assigned'] || null
                        };
                    } else {
                        // Airtable fetch failed, use data from submissions
                        airtableData = {
                            studentName: lastSubmission?.studentName || '(unknown)',
                            course: lastSubmission?.courseId || null,
                            institution: null,
                            courseStartDate: null,
                            courseEndDate: null,
                            courseExtDate: null,
                            mentorId: null
                        };
                    }

                    // Upsert student record
                    await studentsColl.updateOne(
                        { studentId },
                        {
                            $set: {
                                ...airtableData,
                                lastSubmissionAt: lastSubmission?.createdAt || new Date(),
                                lastSyncedAt: new Date()
                            },
                            $setOnInsert: {
                                studentId,
                                createdAt: lastSubmission?.createdAt || new Date()
                            }
                        },
                        { upsert: true }
                    );

                    syncedCount++;
                } catch (err) {
                    errorCount++;
                    errors.push({ studentId, error: err.message });
                }
            }
        }

        return {
            statusCode: 200,
            headers: { ...getCorsHeaders('GET,OPTIONS'), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ok: true,
                syncedCount,
                errorCount,
                totalStudents: studentIdsFromDB.length,
                errors: errors.slice(0, 10) // Only return first 10 errors
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Server error', message: err.message })
        };
    }
};
