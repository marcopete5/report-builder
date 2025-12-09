// Quick script to check if a student has an email address
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { getDb } = require('../netlify/functions/utils/database');

async function checkStudentEmail() {
    const studentId = process.argv[2];

    if (!studentId) {
        console.log('Usage: node scripts/check-student-email.js <studentId>');
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

        console.log('\n=== Student Record ===');
        console.log('Name:', student.studentName || 'N/A');
        console.log('Student ID:', student.studentId);
        console.log('Email:', student.email || '❌ NO EMAIL ADDRESS');
        console.log('Mentor:', student.mentorName || 'N/A');
        console.log('Mentor Email:', student.mentorEmail || 'N/A');
        console.log('\n=== Full Student Record ===');
        console.log(JSON.stringify(student, null, 2));

        if (!student.email) {
            console.log('\n⚠️  WARNING: This student has no email address!');
            console.log('Notifications cannot be sent to students without email addresses.');
            console.log('You need to update the student record with an email address.');
        } else {
            console.log('\n✅ Student has email address:', student.email);
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkStudentEmail();
