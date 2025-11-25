// Quick test script for Google Ads API
require('dotenv').config();
const { testConnection, getCampaignPerformance } = require('./netlify/functions/utils/google-ads-client');

async function runTest() {
    console.log('Testing Google Ads API Connection...\n');

    try {
        // Test basic connection
        console.log('1. Testing connection...');
        const connectionTest = await testConnection();

        if (!connectionTest.success) {
            console.error('❌ Connection failed:', connectionTest.error);
            console.log('\nConfiguration status:', connectionTest.config);
            return;
        }

        console.log('✅ Connection successful!');
        console.log('   Account:', connectionTest.account.descriptiveName || connectionTest.account.id);
        console.log('   Customer ID:', connectionTest.account.id);

        // Fetch sample data (last 7 days)
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        console.log(`\n2. Fetching campaign data (${startDate} to ${endDate})...`);
        const campaignData = await getCampaignPerformance(startDate, endDate);

        console.log(`✅ Retrieved ${campaignData.length} campaign-day records\n`);

        // Calculate summary
        const summary = campaignData.reduce((acc, row) => {
            acc.totalImpressions += row.impressions;
            acc.totalClicks += row.clicks;
            acc.totalCost += row.cost;
            acc.totalConversions += row.conversions;
            return acc;
        }, {
            totalImpressions: 0,
            totalClicks: 0,
            totalCost: 0,
            totalConversions: 0
        });

        console.log('=== SUMMARY (Last 7 Days) ===');
        console.log('Impressions:', summary.totalImpressions.toLocaleString());
        console.log('Clicks:', summary.totalClicks.toLocaleString());
        console.log('Cost: $' + summary.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        console.log('Conversions:', summary.totalConversions.toLocaleString());

        if (summary.totalClicks > 0) {
            const ctr = (summary.totalClicks / summary.totalImpressions * 100).toFixed(2);
            const cpc = (summary.totalCost / summary.totalClicks).toFixed(2);
            console.log('CTR:', ctr + '%');
            console.log('Avg CPC: $' + cpc);
        }

        console.log('\n=== SAMPLE DATA (First 5 Campaigns) ===');
        campaignData.slice(0, 5).forEach((row, i) => {
            console.log(`\n${i + 1}. ${row.campaignName}`);
            console.log(`   Date: ${row.date}`);
            console.log(`   Status: ${row.campaignStatus}`);
            console.log(`   Impressions: ${row.impressions.toLocaleString()}`);
            console.log(`   Clicks: ${row.clicks}`);
            console.log(`   Cost: $${row.cost.toFixed(2)}`);
            console.log(`   Conversions: ${row.conversions}`);
        });

        console.log('\n✅ Test completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

runTest();
