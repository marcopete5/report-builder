// /.netlify/functions/lesson-entry
// Stores lesson entries in MongoDB Atlas

const { getDb, createLessonEntryIndexes, createStudentIndexes } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { validateLessonEntry } = require('./utils/validation');

exports.handler = async (event) => {
    // Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: getCorsHeaders('POST,OPTIONS'), body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const {
            studentName,
            studentId,
            courseId,
            lessonId,
            lessonTitle,
            pageUrl,
            utm = {},
            extra = {}
        } = body;

        // Validate input
        const validation = validateLessonEntry(body);
        if (!validation.valid) {
            return {
                statusCode: 400,
                headers: getCorsHeaders('POST,OPTIONS'),
                body: JSON.stringify({
                    error: 'Validation failed',
                    details: validation.errors
                })
            };
        }

        const ip = event.headers['x-forwarded-for'] || null;
        const userAgent = event.headers['user-agent'] || null;

        // Create timestamp in MST (UTC-7)
        const now = new Date();
        const mstOffset = -7 * 60; // MST is UTC-7
        const mstTime = new Date(now.getTime() + mstOffset * 60 * 1000);

        const doc = {
            createdAt: mstTime,
            studentName,
            studentId, // Required field, validated above
            courseId: courseId || null,
            lessonId,
            lessonTitle: lessonTitle || null,
            pageUrl: pageUrl || null,
            utm: {
                source: utm.source || null,
                medium: utm.medium || null,
                campaign: utm.campaign || null,
                term: utm.term || null,
                content: utm.content || null
            },
            userAgent,
            ip,
            extra
        };

        const db = await getDb();
        await createLessonEntryIndexes(db);
        await createStudentIndexes(db);

        const result = await db.collection('lesson_entries').insertOne(doc);
        const entryId = result.insertedId;

        // Upsert student record to cache Airtable data
        // studentId is now required, so this will always execute

        // Initialize with minimal student data as fallback
        let airtableData = {
            studentName: studentName,
            course: courseId || null,
            institution: null,
            courseStartDate: null,
            courseEndDate: null,
            courseExtDate: null,
            mentorId: null
        };

        // Try to fetch enriched data from Airtable (but don't fail if this doesn't work)
        try {
            const {
                AIRTABLE_API_KEY,
                AIRTABLE_BASE_ID,
                AIRTABLE_TABLE = 'Students'
            } = process.env;

            if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
                const airtableUrl = `https://api.airtable.com/v0/${encodeURIComponent(
                    AIRTABLE_BASE_ID
                )}/${encodeURIComponent(AIRTABLE_TABLE)}/${encodeURIComponent(studentId)}`;

                const airtableRes = await fetch(airtableUrl, {
                    headers: {
                        Authorization: `Bearer ${AIRTABLE_API_KEY}`
                    }
                });

                if (airtableRes.ok) {
                    const record = await airtableRes.json();
                    const fields = record.fields || {};

                    // Override with Airtable data if available
                    airtableData = {
                        studentName: fields['Student Name'] || studentName,
                        course: fields['Course Subject'] || courseId,
                        institution: fields['Enrolling Institution'] || null,
                        courseStartDate: fields['Course Start Date'] || null,
                        courseEndDate: fields['Course End Date'] || null,
                        courseExtDate: fields['Course Ext Date'] || null,
                        mentorId: fields['Mentor Assigned'] || null
                    };
                }
            }
        } catch (airtableErr) {
            // Log Airtable error but continue with basic student data
            console.warn('Airtable fetch failed, using basic student data:', {
                studentId,
                error: airtableErr.message
            });
        }

        // ALWAYS upsert the student record (even if Airtable fetch failed)
        // This ensures every lesson entry has a corresponding student record
        // AND maintains bidirectional relationship by adding entry ID to student's array
        try {
            await db.collection('students').updateOne(
                { studentId },
                {
                    $set: {
                        ...airtableData,
                        lastSubmissionAt: mstTime,
                        lastSyncedAt: new Date()
                    },
                    $setOnInsert: {
                        studentId,
                        createdAt: mstTime
                    },
                    $addToSet: {
                        lessonEntries: entryId // Add entry ID to student's lessonEntries array
                    }
                },
                { upsert: true }
            );
        } catch (dbErr) {
            // This is a critical error - log it prominently
            console.error('CRITICAL: Failed to upsert student record to database:', {
                studentId,
                studentName,
                error: dbErr.message,
                stack: dbErr.stack
            });
            // Still continue - the lesson entry was already saved
        }

        // Optional Zapier forward (set ZAPIER_HOOK_URL in Netlify > Env vars)
        if (process.env.ZAPIER_HOOK_URL) {
            try {
                await fetch(process.env.ZAPIER_HOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...doc,
                        insertedId: result.insertedId
                    })
                });
            } catch (e) {
            }
        }

        return {
            statusCode: 200,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({
                ok: true,
                insertedId: String(result.insertedId)
            })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('POST,OPTIONS'),
            body: JSON.stringify({ error: 'Server error' })
        };
    }
};
