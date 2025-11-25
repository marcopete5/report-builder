// /.netlify/functions/google-ads-sync
// Syncs Google Ads data to MongoDB for the Ad Spend Dashboard

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { getCampaignPerformance, getCampaignPerformanceWithConversions } = require('./utils/google-ads-client');

/**
 * Classify conversion action as interview, contact, or other
 * Based on conversion action names from Google Ads
 */
function classifyConversionAction(conversionActionName) {
    if (!conversionActionName) return 'other';

    const name = conversionActionName.toLowerCase();

    // Interview conversions: appointment scheduling
    if (name.includes('appointment_scheduled') ||
        name.includes('calendly_scheduled') ||
        name.includes('interview') ||
        name.includes('schedule')) {
        return 'interviews';
    }

    // Contact conversions: form submissions, applications
    if (name.includes('apply_complete') ||
        name.includes('contact') ||
        name.includes('form_submit') ||
        name.includes('lead_form')) {
        return 'contacts';
    }

    return 'other';
}

/**
 * Parse date string in YYYYMMDD or YYYY-MM-DD format to Date object
 */
function parseGoogleAdsDate(dateStr) {
    if (!dateStr) return new Date();

    // Handle both YYYYMMDD and YYYY-MM-DD formats
    if (dateStr.includes('-')) {
        // YYYY-MM-DD format
        return new Date(dateStr);
    } else {
        // YYYYMMDD format
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
        const day = parseInt(dateStr.substring(6, 8));
        return new Date(year, month, day);
    }
}

/**
 * Sync Google Ads data for a date range
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} Sync results
 */
async function syncGoogleAdsData(startDate, endDate) {
    try {
        // Fetch campaign performance with conversion breakdown from Google Ads
        console.log(`Fetching Google Ads data with conversion breakdown from ${startDate} to ${endDate}...`);
        const data = await getCampaignPerformanceWithConversions(startDate, endDate);

        console.log(`Received ${data.performance?.length || 0} performance records and ${data.conversions?.length || 0} conversion records`);

        if (!data.performance || data.performance.length === 0) {
            console.log('No campaign data found for this date range');
            return {
                success: true,
                message: 'No data returned from Google Ads for the specified date range. This may be because there were no active campaigns or no ad spend during this period.',
                recordsProcessed: 0,
                recordsInserted: 0,
                recordsUpdated: 0,
                dateRange: { startDate, endDate }
            };
        }

        // Start with performance data (impressions, clicks, cost)
        const aggregatedData = {};

        for (const perf of data.performance) {
            const key = `${perf.date}_${perf.campaignId}`;
            aggregatedData[key] = {
                date: perf.date,
                campaignId: perf.campaignId,
                campaignName: perf.campaignName,
                campaignStatus: perf.campaignStatus,
                impressions: perf.impressions,
                clicks: perf.clicks,
                cost: perf.cost,
                interviews: 0,
                contacts: 0,
                otherConversions: 0,
                conversionsValue: 0
            };
        }

        // Add conversion data by type
        for (const conv of data.conversions) {
            const key = `${conv.date}_${conv.campaignId}`;

            // Skip if no performance data for this key (shouldn't happen)
            if (!aggregatedData[key]) {
                console.warn(`No performance data for ${key}, skipping conversion`);
                continue;
            }

            // Classify and aggregate conversions by type
            const conversionType = classifyConversionAction(conv.conversionActionName);

            if (conversionType === 'interviews') {
                aggregatedData[key].interviews += conv.conversions;
            } else if (conversionType === 'contacts') {
                aggregatedData[key].contacts += conv.conversions;
            } else {
                aggregatedData[key].otherConversions += conv.conversions;
            }

            aggregatedData[key].conversionsValue += conv.conversionsValue;
        }

        // Connect to MongoDB
        const db = await getDb();
        const coll = db.collection('ad_spend');

        // Ensure indexes exist
        await coll.createIndexes([
            { key: { date: -1, campaign_id: 1, platform: 1 }, name: 'unique_daily_campaign', unique: true },
            { key: { date: -1 }, name: 'date_desc' },
            { key: { campaign_type: 1 }, name: 'campaign_type_idx' },
            { key: { synced_at: -1 }, name: 'synced_at_desc' }
        ]);

        let recordsInserted = 0;
        let recordsUpdated = 0;
        let errors = [];

        // Process each aggregated data point
        for (const data of Object.values(aggregatedData)) {
            try {
                // Determine campaign type based on which conversion type is dominant
                let campaign_type = 'general';
                if (data.interviews > data.contacts) {
                    campaign_type = 'interviews';
                } else if (data.contacts > 0) {
                    campaign_type = 'contacts';
                }

                const document = {
                    date: parseGoogleAdsDate(data.date),
                    impressions: data.impressions,
                    clicks: data.clicks,
                    cost: data.cost,
                    // Leads = interviews + contacts
                    leads: data.interviews + data.contacts,
                    // Store separate conversion types
                    interviews: data.interviews,
                    contacts: data.contacts,
                    other_conversions: data.otherConversions,
                    // Total conversions for compatibility
                    conversions: data.interviews + data.contacts + data.otherConversions,
                    revenue: data.conversionsValue || 0,
                    campaign_type: campaign_type,
                    campaign: data.campaignName,
                    campaign_id: data.campaignId,
                    campaign_status: data.campaignStatus,
                    platform: 'Google Ads',
                    source: 'google_ads',
                    synced_at: new Date()
                };

                // Upsert (update if exists, insert if not)
                const result = await coll.updateOne(
                    {
                        date: document.date,
                        campaign_id: document.campaign_id,
                        platform: document.platform
                    },
                    {
                        $set: document
                    },
                    {
                        upsert: true
                    }
                );

                if (result.upsertedCount > 0) {
                    recordsInserted++;
                } else if (result.modifiedCount > 0) {
                    recordsUpdated++;
                }
            } catch (err) {
                console.error('Error processing record:', err);
                errors.push({
                    data,
                    error: err.message
                });
            }
        }

        return {
            success: true,
            message: 'Google Ads data synced successfully with conversion type breakdown',
            dateRange: { startDate, endDate },
            recordsProcessed: Object.keys(aggregatedData).length,
            recordsInserted,
            recordsUpdated,
            errors: errors.length > 0 ? errors : undefined
        };
    } catch (err) {
        console.error('Sync error:', err);
        console.error('Error stack:', err.stack);
        return {
            success: false,
            error: err.message,
            errorDetails: err.toString(),
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        };
    }
}

/**
 * Netlify Function handler
 */
exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    // Require admin authentication for manual triggers
    // For scheduled functions, Netlify doesn't send headers, so we skip auth
    const isScheduled = event.headers['x-nf-event'] === 'schedule';

    if (!isScheduled) {
        const authError = requireAdmin(event, corsHeaders);
        if (authError) {
            return authError;
        }
    }

    try {
        const q = event.queryStringParameters || {};

        // Default to last 90 days if no range specified
        // This ensures we maintain enough historical data for month-over-month and year-over-year comparisons
        const endDate = q.endDate || new Date().toISOString().split('T')[0];
        const startDate = q.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        console.log(`Starting Google Ads sync for ${startDate} to ${endDate}`);

        const result = await syncGoogleAdsData(startDate, endDate);

        console.log('Sync result:', result);

        return {
            statusCode: result.success ? 200 : 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(result)
        };
    } catch (err) {
        console.error('Handler error:', err);
        console.error('Handler error stack:', err.stack);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: false,
                error: err.message,
                errorType: err.name,
                errorDetails: err.toString(),
                stack: err.stack
            })
        };
    }
};

// Export sync function for use in other modules
module.exports.syncGoogleAdsData = syncGoogleAdsData;
