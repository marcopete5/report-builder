// Update the test rule to not filter by student status
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { MongoClient } = require('mongodb');

async function updateRule() {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB || 'Reports';

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);

    const rulesCol = db.collection('notification_rules');

    // Update the rule to check ALL students, not just current ones
    await rulesCol.updateOne(
        { id: 'inactive-7-days' },
        {
            $set: {
                'filters.student_status': [] // Empty array = all students
            }
        }
    );

    console.log('✅ Rule updated to check all students (not just current)');

    await client.close();
}

updateRule().catch(console.error);
