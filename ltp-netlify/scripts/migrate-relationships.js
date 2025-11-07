#!/usr/bin/env node

// Script to retroactively create bidirectional relationships
// between students and their lesson_entries/lesson_feedback

const { MongoClient } = require('mongodb');

async function migrateRelationships() {
    // Get MongoDB URI from environment or command line argument
    const uri = process.env.MONGODB_URI || process.argv[2];

    if (!uri) {
        console.error('❌ Missing MONGODB_URI environment variable');
        console.error('Usage: node scripts/migrate-relationships.js [MONGODB_URI]');
        console.error('   or: MONGODB_URI="..." node scripts/migrate-relationships.js');
        process.exit(1);
    }

    const client = new MongoClient(uri);

    try {
        console.log('🔌 Connecting to MongoDB...');
        await client.connect();

        const db = client.db(process.env.MONGODB_DB || 'Reports');

        const studentsCollection = db.collection('students');
        const entriesCollection = db.collection('lesson_entries');
        const feedbackCollection = db.collection('lesson_feedback');

        console.log('📊 Starting migration...\n');

        let stats = {
            studentsProcessed: 0,
            entriesLinked: 0,
            feedbackLinked: 0,
            errors: []
        };

        // Get all students
        const students = await studentsCollection.find({}).toArray();
        console.log(`Found ${students.length} students to process\n`);

        for (const student of students) {
            try {
                const studentId = student.studentId;
                process.stdout.write(`Processing ${student.studentName || studentId}... `);

                // Find all lesson entries for this student
                const entries = await entriesCollection
                    .find({ studentId })
                    .project({ _id: 1 })
                    .toArray();

                const entryIds = entries.map(e => e._id);

                // Find all feedback for this student
                const feedbacks = await feedbackCollection
                    .find({ studentId })
                    .project({ _id: 1 })
                    .toArray();

                const feedbackIds = feedbacks.map(f => f._id);

                // Update student record with arrays of IDs
                await studentsCollection.updateOne(
                    { studentId },
                    {
                        $set: {
                            lessonEntries: entryIds,
                            lessonFeedback: feedbackIds,
                            migratedAt: new Date()
                        }
                    }
                );

                stats.studentsProcessed++;
                stats.entriesLinked += entryIds.length;
                stats.feedbackLinked += feedbackIds.length;

                console.log(`✅ ${entryIds.length} entries, ${feedbackIds.length} feedback`);

            } catch (err) {
                console.log(`❌ Error: ${err.message}`);
                stats.errors.push({
                    studentId: student.studentId,
                    error: err.message
                });
            }
        }

        console.log('\n📈 Migration Summary:');
        console.log('═══════════════════════════════════════');
        console.log(`Students Processed: ${stats.studentsProcessed}`);
        console.log(`Total Entries Linked: ${stats.entriesLinked}`);
        console.log(`Total Feedback Linked: ${stats.feedbackLinked}`);
        console.log(`Errors: ${stats.errors.length}`);

        if (stats.errors.length > 0) {
            console.log('\n❌ Errors:');
            stats.errors.forEach(err => {
                console.log(`  - ${err.studentId}: ${err.error}`);
            });
        }

        console.log('\n✅ Migration completed successfully!');

    } catch (err) {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    } finally {
        await client.close();
        console.log('🔌 Connection closed');
    }
}

// Run the migration
migrateRelationships().catch(console.error);
