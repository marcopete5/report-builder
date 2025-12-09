// Quick script to list all notification rules
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { getDb } = require('../netlify/functions/utils/database');

async function listRules() {
    try {
        const db = await getDb();
        const rules = await db.collection('notification_rules').find({}).toArray();

        console.log(`\n=== Notification Rules (${rules.length}) ===\n`);

        if (rules.length === 0) {
            console.log('❌ No rules found in database!');
            console.log('\nYou need to create a rule first.');
            console.log('Run: node scripts/seed-notification-system.js');
        } else {
            for (const rule of rules) {
                console.log(`${rule.enabled ? '✅' : '❌'} ${rule.name}`);
                console.log(`   ID: ${rule.id}`);
                console.log(`   Condition: ${rule.condition.type}`);
                console.log(`   Template: ${rule.actions[0]?.template_id || 'N/A'}`);
                console.log('');
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

listRules();
