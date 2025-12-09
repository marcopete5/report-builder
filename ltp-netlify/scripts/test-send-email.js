// Direct test of email sending with Resend
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });

async function testSendEmail() {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
        console.error('❌ RESEND_API_KEY not found in environment');
        process.exit(1);
    }

    console.log('✅ RESEND_API_KEY found:', RESEND_API_KEY.substring(0, 10) + '...');

    const emailData = {
        from: 'V School <tools@vschool.io>',
        to: 'marcus+tester@vschool.io',
        subject: 'Test Email from Notification System - Domain Verified!',
        html: '<h1>✅ Success!</h1><p>This email was sent from the verified vschool.io domain.</p><p>The notification system is now fully operational!</p>'
    };

    console.log('\nSending test email...');
    console.log('To:', emailData.to);
    console.log('From:', emailData.from);

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(emailData),
        });

        console.log('\nResend API Response Status:', response.status);

        const result = await response.json();
        console.log('Resend API Response:', JSON.stringify(result, null, 2));

        if (!response.ok) {
            console.error('\n❌ Failed to send email!');
            console.error('Error:', result);
            process.exit(1);
        }

        console.log('\n✅ Email sent successfully!');
        console.log('Message ID:', result.id);
        console.log('\nCheck the inbox for marcus+tester@vschool.io');
        console.log('Also check Resend dashboard: https://resend.com/emails');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error sending email:', error);
        process.exit(1);
    }
}

testSendEmail();
