// Script to add pace warning templates
// Run with: node scripts/add-pace-templates.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { MongoClient } = require('mongodb');

async function addPaceTemplates() {
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

    const templatesCol = db.collection('email_templates');

    // Template 1: 5% Behind Pace
    const fivePercentBehindTemplate = {
        id: 'pace-warning-5-percent',
        name: '5% Behind Pace Warning',
        subject: 'You\'re falling a bit behind, {{studentName}} - Let\'s get back on track!',
        html_body: `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .stats-box { background-color: white; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .stats-box h3 { margin-top: 0; color: #f59e0b; }
        .button { display: inline-block; padding: 12px 30px; background-color: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        .highlight { color: #f59e0b; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Pace Check-In</h1>
        </div>
        <div class="content">
            <p>Hi {{studentName}},</p>

            <p>We're checking in because you're starting to fall a bit behind your expected pace in <strong>{{course}}</strong>.</p>

            <div class="stats-box">
                <h3>Your Progress Stats</h3>
                <ul style="list-style: none; padding: 0;">
                    <li>📈 Current Progress: <strong>{{percentComplete}}% complete</strong></li>
                    <li>🎯 Expected Progress: <strong>{{expectedLevel}} levels</strong></li>
                    <li>📍 Your Current Level: <strong>{{currentLevel}}</strong></li>
                    <li>⏰ Days Remaining: <strong>{{daysRemaining}} days</strong></li>
                </ul>
            </div>

            <p>The good news is that you're only <span class="highlight">slightly behind</span>, which means it's the perfect time to adjust and get back on track!</p>

            <p><strong>Here's how to catch up:</strong></p>
            <ul>
                <li>📅 Block out dedicated study time each day</li>
                <li>🎯 Focus on completing one lesson at a time</li>
                <li>💬 Reach out to {{mentorName}} for support and guidance</li>
                <li>🤝 Join study groups with other students for accountability</li>
            </ul>

            <p>Remember, everyone's learning journey has ups and downs. The key is to keep moving forward. You've got {{daysRemaining}} days left, and we're here to help you make the most of them!</p>

            <p>Need help? Reply to this email or reach out to your mentor at {{mentorEmail}}.</p>

            <p>You've got this! 💪</p>

            <p>Best regards,<br>The V School Team</p>
        </div>
        <div class="footer">
            <p>V School | Building careers through code</p>
            <p>Track your progress at <a href="https://your-portal-url.com">your student portal</a></p>
        </div>
    </div>
</body>
</html>
        `,
        text_body: `Hi {{studentName}},

We're checking in because you're starting to fall a bit behind your expected pace in {{course}}.

Your Progress Stats:
- Current Progress: {{percentComplete}}% complete
- Expected Level: {{expectedLevel}}
- Your Current Level: {{currentLevel}}
- Days Remaining: {{daysRemaining}} days

The good news is that you're only slightly behind, which means it's the perfect time to adjust and get back on track!

Here's how to catch up:
- Block out dedicated study time each day
- Focus on completing one lesson at a time
- Reach out to {{mentorName}} for support
- Join study groups with other students

You've got {{daysRemaining}} days left, and we're here to help you make the most of them!

Need help? Reach out to your mentor at {{mentorEmail}}.

You've got this!

- The V School Team`,
        available_variables: [
            'studentName',
            'mentorName',
            'mentorEmail',
            'course',
            'currentLevel',
            'expectedLevel',
            'behindBy',
            'daysRemaining',
            'percentComplete'
        ],
        created_at: new Date()
    };

    // Template 2: 10% Behind Pace
    const tenPercentBehindTemplate = {
        id: 'pace-warning-10-percent',
        name: '10% Behind Pace - Urgent',
        subject: 'Action Required: You\'re significantly behind pace, {{studentName}}',
        html_body: `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px 20px; background-color: #f9f9f9; }
        .urgent-box { background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .urgent-box h3 { margin-top: 0; color: #dc2626; }
        .stats-box { background-color: white; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .stats-box h3 { margin-top: 0; color: #dc2626; }
        .button { display: inline-block; padding: 12px 30px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        .highlight { color: #dc2626; font-weight: bold; }
        .action-items { background-color: #dbeafe; padding: 15px; border-radius: 4px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 Urgent: Pace Check-In</h1>
        </div>
        <div class="content">
            <p>Hi {{studentName}},</p>

            <div class="urgent-box">
                <h3>⚠️ Action Required</h3>
                <p>We need to talk about your progress in <strong>{{course}}</strong>. You're now <span class="highlight">significantly behind</span> your expected pace, and we want to help you get back on track.</p>
            </div>

            <div class="stats-box">
                <h3>Your Current Progress</h3>
                <ul style="list-style: none; padding: 0;">
                    <li>📍 Your Current Level: <strong>{{currentLevel}}</strong></li>
                    <li>🎯 Expected Level: <strong>{{expectedLevel}}</strong></li>
                    <li>📉 Behind By: <strong>{{behindBy}} levels</strong></li>
                    <li>📈 Progress: <strong>{{percentComplete}}% complete</strong></li>
                    <li>⏰ Days Remaining: <strong>{{daysRemaining}} days</strong></li>
                </ul>
            </div>

            <p>We know that falling behind can feel overwhelming, but <strong>it's not too late to turn things around</strong>. However, we need to act now to create a recovery plan.</p>

            <div class="action-items">
                <h3 style="margin-top: 0; color: #1e40af;">📋 Required Next Steps:</h3>
                <ol>
                    <li><strong>Schedule a call with {{mentorName}}</strong> this week at {{mentorEmail}}</li>
                    <li><strong>Review your schedule</strong> and block out additional study time</li>
                    <li><strong>Set daily goals</strong> - aim to complete at least one lesson per day</li>
                    <li><strong>Join office hours</strong> or study sessions for extra support</li>
                    <li><strong>Identify blockers</strong> - are you stuck on specific concepts?</li>
                </ol>
            </div>

            <p><strong>We're here to support you:</strong></p>
            <ul>
                <li>🎯 Your mentor {{mentorName}} can help you create a personalized catch-up plan</li>
                <li>💬 Join our community chat for daily motivation and support</li>
                <li>📚 Access additional resources and study guides</li>
                <li>🤝 Connect with successful students who've overcome similar challenges</li>
            </ul>

            <p>With {{daysRemaining}} days remaining, you'll need to increase your pace, but it's absolutely doable with the right plan and support.</p>

            <p style="background-color: #fef3c7; padding: 15px; border-radius: 4px; border-left: 4px solid #f59e0b;">
                <strong>⏰ Time-Sensitive:</strong> Please reach out to {{mentorName}} within the next 48 hours to discuss your plan. We want to see you succeed!
            </p>

            <p>Remember, asking for help is a sign of strength, not weakness. Let's work together to get you back on track.</p>

            <p>Best regards,<br>The V School Team</p>

            <p><em>P.S. If you're facing personal challenges that are affecting your studies, please let us know. We're here to support you holistically, not just academically.</em></p>
        </div>
        <div class="footer">
            <p>V School | Building careers through code</p>
            <p>Contact your mentor: {{mentorEmail}}</p>
        </div>
    </div>
</body>
</html>
        `,
        text_body: `Hi {{studentName}},

⚠️ ACTION REQUIRED ⚠️

We need to talk about your progress in {{course}}. You're now significantly behind your expected pace, and we want to help you get back on track.

Your Current Progress:
- Your Current Level: {{currentLevel}}
- Expected Level: {{expectedLevel}}
- Behind By: {{behindBy}} levels
- Progress: {{percentComplete}}% complete
- Days Remaining: {{daysRemaining}} days

It's not too late to turn things around, but we need to act now.

REQUIRED NEXT STEPS:
1. Schedule a call with {{mentorName}} this week ({{mentorEmail}})
2. Review your schedule and block out additional study time
3. Set daily goals - aim to complete at least one lesson per day
4. Join office hours or study sessions for extra support
5. Identify what's blocking your progress

With {{daysRemaining}} days remaining, you'll need to increase your pace, but it's absolutely doable with the right plan and support.

⏰ TIME-SENSITIVE: Please reach out to {{mentorName}} within the next 48 hours.

We're here to support you. Let's work together to get you back on track.

- The V School Team

P.S. If you're facing personal challenges affecting your studies, please let us know.`,
        available_variables: [
            'studentName',
            'mentorName',
            'mentorEmail',
            'course',
            'currentLevel',
            'expectedLevel',
            'behindBy',
            'daysRemaining',
            'percentComplete'
        ],
        created_at: new Date()
    };

    // Insert or update templates
    console.log('\n=== Adding 5% Behind Pace Template ===');
    const existing5 = await templatesCol.findOne({ id: fivePercentBehindTemplate.id });
    if (existing5) {
        console.log(`Template '${fivePercentBehindTemplate.id}' already exists. Updating...`);
        await templatesCol.updateOne(
            { id: fivePercentBehindTemplate.id },
            { $set: fivePercentBehindTemplate }
        );
    } else {
        console.log(`Creating template '${fivePercentBehindTemplate.id}'...`);
        await templatesCol.insertOne(fivePercentBehindTemplate);
    }
    console.log('✅ 5% Behind Pace template created/updated');

    console.log('\n=== Adding 10% Behind Pace Template ===');
    const existing10 = await templatesCol.findOne({ id: tenPercentBehindTemplate.id });
    if (existing10) {
        console.log(`Template '${tenPercentBehindTemplate.id}' already exists. Updating...`);
        await templatesCol.updateOne(
            { id: tenPercentBehindTemplate.id },
            { $set: tenPercentBehindTemplate }
        );
    } else {
        console.log(`Creating template '${tenPercentBehindTemplate.id}'...`);
        await templatesCol.insertOne(tenPercentBehindTemplate);
    }
    console.log('✅ 10% Behind Pace template created/updated');

    console.log('\n=== Summary ===');
    console.log('Created/Updated Templates:');
    console.log('  1. pace-warning-5-percent - 5% Behind Pace Warning');
    console.log('  2. pace-warning-10-percent - 10% Behind Pace - Urgent');
    console.log('\n✅ Pace templates added successfully!');
    console.log('\nYou can now create notification rules using these templates.');

    await client.close();
}

addPaceTemplates().catch(console.error);
