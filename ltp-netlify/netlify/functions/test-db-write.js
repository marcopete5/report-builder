// Simple test to verify database write operations work
const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        console.log('Step 1: Connecting to database...');
        const db = await getDb();
        console.log('Step 1: SUCCESS - Connected to database');

        console.log('Step 2: Getting ad_spend collection...');
        const coll = db.collection('ad_spend');
        console.log('Step 2: SUCCESS - Got collection reference');

        console.log('Step 3: Creating test document...');
        const testDoc = {
            date: new Date('2025-10-01'),
            campaign: 'TEST CAMPAIGN',
            campaign_id: 'test-123',
            campaign_type: 'general',
            platform: 'Google Ads',
            impressions: 100,
            clicks: 10,
            cost: 50.00,
            leads: 2,
            conversions: 2,
            revenue: 0,
            campaign_status: 'ENABLED',
            source: 'test',
            synced_at: new Date()
        };
        console.log('Step 3: SUCCESS - Test document created:', JSON.stringify(testDoc, null, 2));

        console.log('Step 4: Attempting upsert...');
        const result = await coll.updateOne(
            {
                date: testDoc.date,
                campaign_id: testDoc.campaign_id,
                platform: testDoc.platform
            },
            {
                $set: testDoc
            },
            {
                upsert: true
            }
        );
        console.log('Step 4: SUCCESS - Upsert result:', JSON.stringify(result, null, 2));

        console.log('Step 5: Verifying write...');
        const verifyDoc = await coll.findOne({ campaign_id: 'test-123' });
        console.log('Step 5: SUCCESS - Found document:', verifyDoc ? 'YES' : 'NO');

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                message: 'Database write test successful!',
                steps: {
                    connect: 'SUCCESS',
                    getCollection: 'SUCCESS',
                    createDocument: 'SUCCESS',
                    upsert: 'SUCCESS',
                    verify: verifyDoc ? 'SUCCESS' : 'FAILED'
                },
                upsertResult: {
                    upsertedCount: result.upsertedCount,
                    modifiedCount: result.modifiedCount,
                    matchedCount: result.matchedCount
                },
                documentFound: !!verifyDoc
            })
        };
    } catch (err) {
        console.error('ERROR at some step:', err);
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        console.error('Error stack:', err.stack);

        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: false,
                error: err.message,
                errorName: err.name,
                errorType: err.constructor.name,
                stack: err.stack,
                details: err.toString()
            })
        };
    }
};
