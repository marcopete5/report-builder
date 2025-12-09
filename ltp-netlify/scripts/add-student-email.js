// Quick script to add/update a student's email address for testing
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { getDb } = require('../netlify/functions/utils/database');

async function addStudentEmail() {
    const studentId = process.argv[2];
    const email = process.argv[3];

    if (!studentId || !email) {
        console.log('Usage: node scripts/add-student-email.js <studentId> <email>');
        console.log('Example: node scripts/add-student-email.js recXXXXXXXXX test@example.com');
        process.exit(1);
    }

    // Basic email validation
    if (!email.includes('@')) {
        console.log('❌ Invalid email format');
        process.exit(1);
    }

    try {
        const db = await getDb();
        const studentsCol = db.collection('students');

        const student = await studentsCol.findOne({ studentId });

        if (!student) {
            console.log(`❌ Student ${studentId} not found in database`);
            process.exit(1);
        }

        console.log('\n=== Before Update ===');
        console.log('Name:', student.studentName);
        console.log('Current Email:', student.email || '(none)');

        // Update the student's email
        const result = await studentsCol.updateOne(
            { studentId },
            { $set: { email } }
        );

        if (result.modifiedCount > 0) {
            console.log('\n✅ Email updated successfully!');
            console.log('New Email:', email);
            console.log('\nYou can now test sending notifications to this student.');
        } else {
            console.log('\n⚠️  No changes made (email was already set to this value)');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

addStudentEmail();
