// /.netlify/functions/google-ads-backfill
// One-time or on-demand backfill of historical Google Ads data
// This function imports data going back multiple years for historical comparisons

const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { syncGoogleAdsData } = require('./google-ads-sync');

/**
 * Backfill Google Ads data in chunks
 * Google Ads API works best with smaller date ranges, so we'll chunk by month
 */
async function backfillHistoricalData(startDate, endDate) {
    const results = [];
    let currentStart = new Date(startDate);
    const finalEnd = new Date(endDate);

    console.log(`Starting backfill from ${startDate} to ${endDate}`);

    // Process in 30-day chunks to avoid API limits
    while (currentStart < finalEnd) {
        // Calculate chunk end date (30 days from start or finalEnd, whichever is earlier)
        const currentEnd = new Date(currentStart);
        currentEnd.setDate(currentEnd.getDate() + 29); // 30 days inclusive

        const chunkEnd = currentEnd > finalEnd ? finalEnd : currentEnd;

        const chunkStartStr = currentStart.toISOString().split('T')[0];
        const chunkEndStr = chunkEnd.toISOString().split('T')[0];

        console.log(`Syncing chunk: ${chunkStartStr} to ${chunkEndStr}`);

        try {
            const result = await syncGoogleAdsData(chunkStartStr, chunkEndStr);
            results.push({
                dateRange: { start: chunkStartStr, end: chunkEndStr },
                ...result
            });

            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
            console.error(`Error syncing chunk ${chunkStartStr} to ${chunkEndStr}:`, err);
            results.push({
                dateRange: { start: chunkStartStr, end: chunkEndStr },
                success: false,
                error: err.message
            });
        }

        // Move to next chunk
        currentStart = new Date(chunkEnd);
        currentStart.setDate(currentStart.getDate() + 1);
    }

    // Calculate summary
    const totalRecordsInserted = results.reduce((sum, r) => sum + (r.recordsInserted || 0), 0);
    const totalRecordsUpdated = results.reduce((sum, r) => sum + (r.recordsUpdated || 0), 0);
    const totalRecordsProcessed = results.reduce((sum, r) => sum + (r.recordsProcessed || 0), 0);
    const failedChunks = results.filter(r => !r.success).length;

    return {
        success: failedChunks === 0,
        message: `Backfill completed. Processed ${results.length} chunks.`,
        dateRange: { startDate, endDate },
        totalChunks: results.length,
        failedChunks,
        totalRecordsProcessed,
        totalRecordsInserted,
        totalRecordsUpdated,
        chunks: results
    };
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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const q = event.queryStringParameters || {};

        // Default: backfill all available data (5 years to be safe)
        // Google Ads API typically allows 2-5 years of historical data
        // User can customize with ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
        const today = new Date();
        const endDate = q.endDate || today.toISOString().split('T')[0];

        // Default to 5 years ago to capture all available data
        const fiveYearsAgo = new Date(today);
        fiveYearsAgo.setFullYear(today.getFullYear() - 5);
        const startDate = q.startDate || fiveYearsAgo.toISOString().split('T')[0];

        console.log(`Starting backfill from ${startDate} to ${endDate}`);

        const result = await backfillHistoricalData(startDate, endDate);

        console.log('Backfill result:', JSON.stringify(result, null, 2));

        return {
            statusCode: result.success ? 200 : 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(result)
        };
    } catch (err) {
        console.error('Backfill handler error:', err);
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
                errorType: err.name,
                errorDetails: err.toString(),
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            })
        };
    }
};
