// Script to sync student email addresses from Airtable
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { getDb, createStudentIndexes } = require('../netlify/functions/utils/database');

async function syncStudentEmails() {
    try {
        console.log('[Sync Emails] Starting email sync from Airtable...');

        const {
            AIRTABLE_API_KEY,
            AIRTABLE_BASE_ID,
            AIRTABLE_TABLE = 'Students'
        } = process.env;

        if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
            console.error('❌ Airtable credentials not configured');
            process.exit(1);
        }

        const db = await getDb();
        await createStudentIndexes(db);
        const studentsColl = db.collection('students');

        // Get all students from MongoDB
        const allStudents = await studentsColl.find({}).toArray();
        console.log(`Found ${allStudents.length} students in database`);

        const results = {
            total: allStudents.length,
            updated: 0,
            failed: 0,
            skipped: 0,
            withEmail: 0,
            withoutEmail: 0
        };

        for (const student of allStudents) {
            if (!student.studentId) {
                console.log(`⚠️  Skipping student without ID: ${student.studentName}`);
                results.skipped++;
                continue;
            }

            try {
                // Fetch student from Airtable
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

                    const email = fields['Primary Email (from Contact)'];
                    const currentLevel = fields['Current Level'];
                    // Profile Picture is an attachment field - get the first image URL
                    const profilePictureArray = fields['Profile Picture'];
                    const profilePicture = (profilePictureArray && profilePictureArray.length > 0)
                        ? profilePictureArray[0].url
                        : null;

                    // Fetch mentor details if Mentor Assigned exists
                    let mentorName = null;
                    let mentorEmail = null;
                    const mentorId = Array.isArray(fields['Mentor Assigned'])
                        ? fields['Mentor Assigned'][0]
                        : fields['Mentor Assigned'] || null;

                    if (mentorId) {
                        try {
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
                            console.warn(`Failed to fetch mentor:`, mentorErr.message);
                        }
                    }

                    // Update student with all fields
                    const updateFields = {
                        lastSyncedAt: new Date()
                    };

                    if (email) updateFields.email = email;
                    if (currentLevel) updateFields.currentLevel = currentLevel;
                    if (profilePicture) updateFields.profilePicture = profilePicture;
                    if (mentorName) updateFields.mentorName = mentorName;
                    if (mentorEmail) updateFields.mentorEmail = mentorEmail;
                    if (mentorId) updateFields.mentorId = mentorId;

                    await studentsColl.updateOne(
                        { studentId: student.studentId },
                        { $set: updateFields }
                    );

                    console.log(`✅ Updated ${student.studentName}: ${email || 'no email'}, Level: ${currentLevel || 'N/A'}, Mentor: ${mentorName || 'N/A'}`);
                    results.updated++;
                    if (email) {
                        results.withEmail++;
                    } else {
                        results.withoutEmail++;
                    }
                } else if (airtableRes.status === 404) {
                    console.log(`⚠️  Student not found in Airtable: ${student.studentName}`);
                    results.skipped++;
                } else {
                    console.error(`❌ Error fetching ${student.studentName}: ${airtableRes.status}`);
                    results.failed++;
                }

                // Rate limiting - wait a bit between requests
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (err) {
                console.error(`❌ Error processing ${student.studentName}:`, err.message);
                results.failed++;
            }
        }

        console.log('\n=== Sync Complete ===');
        console.log(`Total students: ${results.total}`);
        console.log(`✅ Updated with email: ${results.withEmail}`);
        console.log(`⚠️  No email found: ${results.withoutEmail}`);
        console.log(`⚠️  Skipped: ${results.skipped}`);
        console.log(`❌ Failed: ${results.failed}`);

        process.exit(0);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

syncStudentEmails();
