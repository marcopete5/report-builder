// /.netlify/functions/api-upwork-aggregates
// API endpoint to retrieve Upwork job aggregates

const { getDb } = require('./utils/database');
const { requireAuth } = require('./utils/db-auth');
const { getCorsHeaders } = require('./utils/cors');
const { NICHE_FILTERS, getTokenStatus } = require('./utils/upwork-client');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    // Require authentication
    const authResult = requireAuth(event);
    if (!authResult.authenticated) {
        return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Authentication required' })
        };
    }

    try {
        const db = await getDb();
        const q = event.queryStringParameters || {};
        const type = q.type || 'daily'; // 'daily', 'weekly', or 'overview'

        // Get token status
        const tokenStatus = await getTokenStatus();

        if (type === 'overview') {
            return await getOverview(db, q, corsHeaders, tokenStatus);
        } else if (type === 'weekly') {
            return await getWeeklyAggregates(db, q, corsHeaders);
        } else {
            return await getDailyAggregates(db, q, corsHeaders);
        }
    } catch (err) {
        console.error('[API Upwork Aggregates] Error:', err);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to fetch aggregates', message: err.message })
        };
    }
};

/**
 * Get overview for dashboard
 */
async function getOverview(db, q, corsHeaders, tokenStatus) {
    const niche = q.niche;

    // Get date range (default: last 7 days)
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Build base query
    const baseQuery = { fetched_at: { $gte: startDate, $lte: endDate } };
    if (niche && NICHE_FILTERS[niche]) {
        baseQuery.niche = niche;
    }

    // Get summary stats
    const [
        totalJobs,
        jobsByNiche,
        topSkills,
        topKeywords,
        budgetStats,
        latestWeekly,
        syncState
    ] = await Promise.all([
        // Total jobs in period
        db.collection('upwork_jobs_raw').countDocuments(baseQuery),

        // Jobs by niche
        db.collection('upwork_jobs_raw').aggregate([
            { $match: { fetched_at: { $gte: startDate, $lte: endDate } } },
            { $group: { _id: '$niche', count: { $sum: 1 } } }
        ]).toArray(),

        // Top skills across all niches or filtered
        db.collection('upwork_jobs_raw').aggregate([
            { $match: baseQuery },
            { $unwind: '$skills' },
            { $group: { _id: '$skills', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray(),

        // Top keywords hit
        db.collection('upwork_jobs_raw').aggregate([
            { $match: baseQuery },
            { $unwind: '$keywords_hit' },
            { $group: { _id: '$keywords_hit', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray(),

        // Budget statistics
        db.collection('upwork_jobs_raw').aggregate([
            { $match: { ...baseQuery, contract_kind: { $in: ['fixed', 'hourly'] } } },
            {
                $group: {
                    _id: '$contract_kind',
                    avg_budget: { $avg: '$budget_min' },
                    avg_hourly: { $avg: { $avg: ['$hourly_rate_min', '$hourly_rate_max'] } },
                    count: { $sum: 1 }
                }
            }
        ]).toArray(),

        // Latest weekly aggregate (for repeated asks)
        db.collection('upwork_aggregates_weekly')
            .find(niche ? { niche } : {})
            .sort({ week_start: -1 })
            .limit(niche ? 1 : Object.keys(NICHE_FILTERS).length)
            .toArray(),

        // Sync state
        db.collection('upwork_sync_state').findOne({ type: 'daily_sync' })
    ]);

    // Format niche counts
    const nicheStats = {};
    for (const item of jobsByNiche) {
        if (item._id) nicheStats[item._id] = item.count;
    }

    // Format budget stats
    const budgetSummary = {
        fixed: { avg: null, count: 0 },
        hourly: { avg: null, count: 0 }
    };
    for (const item of budgetStats) {
        if (item._id === 'fixed') {
            budgetSummary.fixed = {
                avg: item.avg_budget ? Math.round(item.avg_budget) : null,
                count: item.count
            };
        } else if (item._id === 'hourly') {
            budgetSummary.hourly = {
                avg: item.avg_hourly ? Math.round(item.avg_hourly * 100) / 100 : null,
                count: item.count
            };
        }
    }

    // Get repeated asks from weekly aggregates
    const repeatedAsks = {};
    for (const weekly of latestWeekly) {
        if (weekly.repeated_asks && weekly.repeated_asks.length > 0) {
            repeatedAsks[weekly.niche] = weekly.repeated_asks.slice(0, 4);
        }
    }

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            period: {
                start: startDate,
                end: endDate,
                days: 7
            },
            summary: {
                total_jobs: totalJobs,
                by_niche: nicheStats,
                budget: budgetSummary
            },
            top_skills: topSkills.map(s => ({ skill: s._id, count: s.count })),
            top_keywords: topKeywords.map(k => ({ keyword: k._id, count: k.count })),
            repeated_asks: repeatedAsks,
            sync_status: {
                last_run: syncState?.last_run,
                token_status: tokenStatus.status,
                token_expires_in_hours: tokenStatus.expires_in_hours
            },
            available_niches: Object.keys(NICHE_FILTERS)
        })
    };
}

/**
 * Get daily aggregates
 */
async function getDailyAggregates(db, q, corsHeaders) {
    const niche = q.niche;
    const days = Math.min(90, Math.max(1, parseInt(q.days) || 7));

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const query = { date: { $gte: startDate, $lte: endDate } };
    if (niche && NICHE_FILTERS[niche]) {
        query.niche = niche;
    }

    const aggregates = await db.collection('upwork_aggregates_daily')
        .find(query)
        .sort({ date: -1 })
        .toArray();

    // Group by date if no niche filter
    const byDate = {};
    for (const agg of aggregates) {
        const dateStr = agg.date.toISOString().split('T')[0];
        if (!byDate[dateStr]) {
            byDate[dateStr] = {};
        }
        byDate[dateStr][agg.niche] = {
            total_jobs: agg.total_jobs,
            top_skills: Object.entries(agg.by_skill || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([skill, count]) => ({ skill, count })),
            budget_stats: agg.budget_stats
        };
    }

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'daily',
            period: { start: startDate, end: endDate, days },
            filter: { niche: niche || 'all' },
            aggregates: byDate
        })
    };
}

/**
 * Get weekly aggregates
 */
async function getWeeklyAggregates(db, q, corsHeaders) {
    const niche = q.niche;
    const weeks = Math.min(12, Math.max(1, parseInt(q.weeks) || 4));

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);

    const query = { week_start: { $gte: startDate } };
    if (niche && NICHE_FILTERS[niche]) {
        query.niche = niche;
    }

    const aggregates = await db.collection('upwork_aggregates_weekly')
        .find(query)
        .sort({ week_start: -1 })
        .toArray();

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'weekly',
            period: { start: startDate, end: endDate, weeks },
            filter: { niche: niche || 'all' },
            aggregates: aggregates.map(agg => ({
                week_start: agg.week_start,
                week_end: agg.week_end,
                niche: agg.niche,
                total_jobs: agg.total_jobs,
                total_jobs_change: agg.total_jobs_change,
                top_skills: agg.top_skills?.slice(0, 10) || [],
                top_keywords: agg.top_keywords?.slice(0, 10) || [],
                top_ngrams: agg.top_ngrams?.slice(0, 10) || [],
                budget_trends: agg.budget_trends,
                repeated_asks: agg.repeated_asks?.slice(0, 5) || []
            }))
        })
    };
}
