// Quick script to list all students with their emails
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { getDb } = require('../netlify/functions/utils/database');

async function listEmails() {
    try {
        const db = await getDb();
        const students = await db.collection('students').find({}).toArray();

        console.log('\n=== Students with Email Addresses ===\n');

        for (const student of students) {
            const hasEmail = student.email ? '✅' : '❌';
            console.log(`${hasEmail} ${student.studentName}`);
            console.log(`   ID: ${student.studentId}`);
            console.log(`   Email: ${student.email || '(none)'}`);
            console.log('');
        }

        const withEmail = students.filter(s => s.email).length;
        const total = students.length;

        console.log(`\n=== Summary ===`);
        console.log(`Total students: ${total}`);
        console.log(`With email: ${withEmail}`);
        console.log(`Without email: ${total - withEmail}`);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

listEmails();
