// /.netlify/functions/google-ads-sync
// Syncs Google Ads data to MongoDB for the Ad Spend Dashboard

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { getCampaignPerformance } = require('./utils/google-ads-client');

/**
 * Classify campaign based on name
 * Customize this logic based on your campaign naming conventions
 */
function classifyCampaign(campaignName) {
    const name = campaignName.toLowerCase();

    if (name.includes('interview')) {
        return 'interviews';
    }
    if (name.includes('contact')) {
        return 'contacts';
    }
    return 'general';
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
        // Fetch campaign performance from Google Ads
        console.log(`Fetching Google Ads data from ${startDate} to ${endDate}...`);
        const campaignData = await getCampaignPerformance(startDate, endDate);

        console.log(`Received ${campaignData ? campaignData.length : 0} records from Google Ads API`);

        if (!campaignData || campaignData.length === 0) {
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

        // Process each campaign data point
        for (const data of campaignData) {
            try {
                const document = {
                    date: parseGoogleAdsDate(data.date),
                    impressions: data.impressions,
                    clicks: data.clicks,
                    cost: data.cost,
                    leads: data.conversions, // Assuming conversions are leads
                    conversions: data.conversions,
                    revenue: data.conversionsValue || 0,
                    campaign_type: classifyCampaign(data.campaignName),
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
            message: 'Google Ads data synced successfully',
            dateRange: { startDate, endDate },
            recordsProcessed: campaignData.length,
            recordsInserted,
            recordsUpdated,
            errors: errors.length > 0 ? errors : undefined
        };
    } catch (err) {
        console.error('Sync error:', err);
        return {
            success: false,
            error: err.message,
            stack: err.stack
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

        // Default to last 7 days if no range specified
        const endDate = q.endDate || new Date().toISOString().split('T')[0];
        const startDate = q.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        console.log(`Starting Google Ads sync for ${startDate} to ${endDate}`);

        const result = await syncGoogleAdsData(startDate, endDate);

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
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: false,
                error: err.message,
                stack: err.stack
            })
        };
    }
};

// Export sync function for use in other modules
module.exports.syncGoogleAdsData = syncGoogleAdsData;
