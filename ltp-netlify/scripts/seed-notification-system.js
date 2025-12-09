// Script to seed the notification system with initial template and rule
// Run with: node scripts/seed-notification-system.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { MongoClient } = require('mongodb');

async function seedNotificationSystem() {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB || 'Reports';

    if (!uri) {
        throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('Connecting to MongoDB...');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);

    console.log('Connected to database:', dbName);

    // Create collections
    const templatesCol = db.collection('email_templates');
    const rulesCol = db.collection('notification_rules');

    console.log('\n=== Creating Email Template ===');

    // Create inactivity warning email template
    const inactivityTemplate = {
        id: 'inactivity-warning-7-days',
        name: '7 Day Inactivity Warning',
        subject: 'We miss you at V School, {{studentName}}!',
        html_body: `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #2C3E50; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .button { display: inline-block; padding: 12px 30px; background-color: #3498db; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>We Miss You!</h1>
        </div>
        <div class="content">
            <p>Hi {{studentName}},</p>

            <p>We noticed you haven't submitted any lessons in <strong>{{daysInactive}} days</strong>. Your last submission was <strong>{{lastLesson}}</strong> on {{lastActivityDate}}.</p>

            <p>We know life can get busy, but staying consistent with your learning is key to your success. Your mentor, {{mentorName}}, is here to help if you're facing any challenges.</p>

            <p><strong>Here's what you can do:</strong></p>
            <ul>
                <li>Schedule time today to work on your next lesson</li>
                <li>Reach out to your mentor if you're stuck or need guidance</li>
                <li>Join our community chat to stay motivated</li>
            </ul>

            <p>Remember, every expert was once a beginner who refused to give up. We believe in you! 💪</p>

            <p>Best regards,<br>The V School Team</p>
        </div>
        <div class="footer">
            <p>V School | Building careers through code</p>
        </div>
    </div>
</body>
</html>
        `,
        text_body: `Hi {{studentName}},

We noticed you haven't submitted any lessons in {{daysInactive}} days. Your last submission was {{lastLesson}}.

We know life can get busy, but staying consistent is key to your success. Your mentor {{mentorName}} is here to help!

Keep pushing forward!

- The V School Team`,
        available_variables: [
            'studentName',
            'mentorName',
            'daysInactive',
            'lastLesson',
            'lastActivityDate',
            'lastLessonId'
        ],
        created_at: new Date()
    };

    // Check if template already exists
    const existingTemplate = await templatesCol.findOne({ id: inactivityTemplate.id });
    if (existingTemplate) {
        console.log(`Template '${inactivityTemplate.id}' already exists. Updating...`);
        await templatesCol.updateOne(
            { id: inactivityTemplate.id },
            { $set: inactivityTemplate }
        );
    } else {
        console.log(`Creating template '${inactivityTemplate.id}'...`);
        await templatesCol.insertOne(inactivityTemplate);
    }

    console.log('✅ Email template created/updated');

    console.log('\n=== Creating Notification Rule ===');

    // Create 7-day inactivity notification rule
    const inactivityRule = {
        id: 'inactive-7-days',
        name: '7 Day Inactivity Warning',
        description: 'Sends a warning email to students who haven\'t submitted any lessons in 7 days',
        enabled: true,
        trigger_type: 'scheduled',
        schedule: 'daily',
        filters: {
            student_status: ['current'],
            courses: [],
            institutions: [],
            exclude_students: []
        },
        condition: {
            type: 'no_activity',
            params: {
                days: 7
            }
        },
        actions: [
            {
                type: 'email',
                template_id: 'inactivity-warning-7-days',
                subject: 'We miss you at V School, {{studentName}}!',
                recipients: {
                    to: ['student'],
                    bcc: ['mentor']
                }
            }
        ],
        cooldown: {
            enabled: true,
            days: 14,
            type: 'per_student'
        },
        created_at: new Date(),
        created_by: 'system',
        updated_at: new Date(),
        last_run_at: null,
        stats: {
            total_triggered: 0,
            total_sent: 0,
            last_triggered_count: 0
        }
    };

    // Check if rule already exists
    const existingRule = await rulesCol.findOne({ id: inactivityRule.id });
    if (existingRule) {
        console.log(`Rule '${inactivityRule.id}' already exists. Updating...`);
        await rulesCol.updateOne(
            { id: inactivityRule.id },
            { $set: { ...inactivityRule, stats: existingRule.stats } }
        );
    } else {
        console.log(`Creating rule '${inactivityRule.id}'...`);
        await rulesCol.insertOne(inactivityRule);
    }

    console.log('✅ Notification rule created/updated');

    console.log('\n=== Summary ===');
    console.log('Email Template:', inactivityTemplate.id);
    console.log('Notification Rule:', inactivityRule.id);
    console.log('\n✅ Notification system seeded successfully!');
    console.log('\nTo test in dry-run mode:');
    console.log('  curl "http://localhost:8888/.netlify/functions/notification-engine?dry_run=true"');
    console.log('\nTo test for a specific student:');
    console.log('  curl "http://localhost:8888/.netlify/functions/notification-engine?dry_run=true&student_id=YOUR_STUDENT_ID"');

    await client.close();
}

seedNotificationSystem().catch(console.error);
