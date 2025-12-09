// Script to test the notification engine
// Shows what students would receive notifications

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { MongoClient } = require('mongodb');

async function testNotificationEngine() {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB || 'Reports';

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);

    const studentsCol = db.collection('students');
    const lessonEntriesCol = db.collection('lesson_entries');

    // Get all students
    const allStudents = await studentsCol.find({}).limit(5).toArray();
    console.log(`\nTotal students in database: ${await studentsCol.countDocuments()}`);

    if (allStudents.length === 0) {
        console.log('\n⚠️  No students found in database!');
        await client.close();
        return;
    }

    console.log('\n=== Sample Students ===');
    for (const student of allStudents) {
        const lastEntry = await lessonEntriesCol
            .find({ studentId: student.studentId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray()
            .then(results => results[0] || null);

        const daysSinceActivity = lastEntry
            ? Math.floor((Date.now() - new Date(lastEntry.createdAt).getTime()) / (1000 * 60 * 60 * 24))
            : 'Never';

        const isCurrent = student.courseEndDate
            ? new Date(student.courseEndDate) >= new Date()
            : 'No end date';

        console.log(`\nStudent: ${student.studentName || 'Unknown'} (${student.studentId})`);
        console.log(`  Email: ${student.email || 'None'}`);
        console.log(`  Course: ${student.course || 'Unknown'}`);
        console.log(`  End Date: ${student.courseEndDate || 'None'}`);
        console.log(`  Current: ${isCurrent}`);
        console.log(`  Last Activity: ${daysSinceActivity} days ago`);
        console.log(`  Would trigger 7-day rule: ${daysSinceActivity >= 7 && isCurrent === true ? '✅ YES' : '❌ No'}`);
    }

    // Count how many would trigger the 7-day rule
    const currentStudents = await studentsCol.find({
        $or: [
            { courseEndDate: { $gte: new Date() } },
            { courseExtDate: { $gte: new Date() } }
        ]
    }).toArray();

    let wouldTrigger = 0;
    for (const student of currentStudents) {
        const lastEntry = await lessonEntriesCol
            .find({ studentId: student.studentId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray()
            .then(results => results[0] || null);

        if (lastEntry) {
            const daysSince = (Date.now() - new Date(lastEntry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince >= 7) {
                wouldTrigger++;
            }
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total students: ${await studentsCol.countDocuments()}`);
    console.log(`Current students: ${currentStudents.length}`);
    console.log(`Would trigger 7-day inactivity rule: ${wouldTrigger}`);

    console.log(`\n✅ Test complete!`);
    console.log(`\nTo run notification engine in dry-run mode:`);
    console.log(`  curl "http://localhost:8888/.netlify/functions/notification-engine?dry_run=true"`);

    await client.close();
}

testNotificationEngine().catch(console.error);
