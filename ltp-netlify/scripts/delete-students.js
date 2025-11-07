#!/usr/bin/env node

// Script to delete students and all their associated data

const { MongoClient } = require('mongodb');

async function deleteStudents(studentNames) {
    const uri = process.env.MONGODB_URI || process.argv[2];

    if (!uri) {
        console.error('❌ Missing MONGODB_URI environment variable');
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

        console.log('🗑️  Starting deletion process...\n');

        let stats = {
            studentsDeleted: 0,
            entriesDeleted: 0,
            feedbackDeleted: 0,
            errors: []
        };

        for (const studentName of studentNames) {
            try {
                console.log(`\nProcessing: ${studentName}`);
                console.log('─'.repeat(50));

                // Find the student record
                const student = await studentsCollection.findOne({ studentName });

                if (!student) {
                    console.log(`⚠️  Student not found in database: ${studentName}`);
                    continue;
                }

                const studentId = student.studentId;
                console.log(`Found student ID: ${studentId}`);

                // Delete all lesson entries for this student
                const entriesResult = await entriesCollection.deleteMany({ studentId });
                console.log(`  📝 Deleted ${entriesResult.deletedCount} lesson entries`);
                stats.entriesDeleted += entriesResult.deletedCount;

                // Delete all feedback for this student
                const feedbackResult = await feedbackCollection.deleteMany({ studentId });
                console.log(`  💬 Deleted ${feedbackResult.deletedCount} feedback items`);
                stats.feedbackDeleted += feedbackResult.deletedCount;

                // Delete the student record
                const studentResult = await studentsCollection.deleteOne({ studentId });
                console.log(`  👤 Deleted student record`);
                stats.studentsDeleted += studentResult.deletedCount;

                console.log(`✅ Completed deletion for ${studentName}`);

            } catch (err) {
                console.log(`❌ Error processing ${studentName}: ${err.message}`);
                stats.errors.push({
                    studentName,
                    error: err.message
                });
            }
        }

        console.log('\n\n📈 Deletion Summary:');
        console.log('═'.repeat(50));
        console.log(`Students Deleted: ${stats.studentsDeleted}`);
        console.log(`Lesson Entries Deleted: ${stats.entriesDeleted}`);
        console.log(`Feedback Deleted: ${stats.feedbackDeleted}`);
        console.log(`Errors: ${stats.errors.length}`);

        if (stats.errors.length > 0) {
            console.log('\n❌ Errors:');
            stats.errors.forEach(err => {
                console.log(`  - ${err.studentName}: ${err.error}`);
            });
        }

        console.log('\n✅ Deletion process completed!');

    } catch (err) {
        console.error('\n❌ Deletion failed:', err);
        process.exit(1);
    } finally {
        await client.close();
        console.log('🔌 Connection closed');
    }
}

// Students to delete
const studentsToDelete = [
    'New Test Student',
    'Casey Rodriguez',
    'Taylor Chen',
    'Jordan Martinez',
    'Alex Thompson'
];

console.log('⚠️  WARNING: This will permanently delete the following students and ALL their data:');
studentsToDelete.forEach(name => console.log(`  - ${name}`));
console.log('\nStarting in 3 seconds...\n');

setTimeout(() => {
    deleteStudents(studentsToDelete).catch(console.error);
}, 3000);
