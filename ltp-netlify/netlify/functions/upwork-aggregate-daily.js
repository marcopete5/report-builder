// /.netlify/functions/upwork-aggregate-daily
// Daily aggregation of Upwork job data
// Schedule: 5:30 AM UTC (after job sync)

const { getDb } = require('./utils/database');
const { NICHE_FILTERS } = require('./utils/upwork-client');
const { getCorsHeaders } = require('./utils/cors');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,OPTIONS');
    const startTime = Date.now();
    const requestId = `agg-daily-${Date.now()}`;

    const isScheduled = event.headers['x-nf-event'] === 'schedule';
    console.log(`[Upwork Aggregate Daily] [${requestId}] Starting (scheduled: ${isScheduled})`);

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        const db = await getDb();
        const q = event.queryStringParameters || {};

        // Default to yesterday if not specified
        const targetDate = q.date
            ? new Date(q.date)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Normalize to start of day UTC
        const dayStart = new Date(Date.UTC(
            targetDate.getUTCFullYear(),
            targetDate.getUTCMonth(),
            targetDate.getUTCDate(),
            0, 0, 0, 0
        ));
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        console.log(`[Upwork Aggregate Daily] [${requestId}] Aggregating for ${dayStart.toISOString().split('T')[0]}`);

        const results = {
            date: dayStart,
            aggregates_created: 0,
            by_niche: {}
        };

        // Process each niche
        for (const niche of Object.keys(NICHE_FILTERS)) {
            const aggregate = await aggregateNicheDaily(db, niche, dayStart, dayEnd);

            if (aggregate.total_jobs > 0) {
                // Store aggregate
                await db.collection('upwork_aggregates_daily').updateOne(
                    { date: dayStart, niche },
                    { $set: aggregate },
                    { upsert: true }
                );

                results.aggregates_created++;
                results.by_niche[niche] = {
                    total_jobs: aggregate.total_jobs,
                    top_skills: Object.entries(aggregate.by_skill)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([skill, count]) => ({ skill, count })),
                    budget_stats: aggregate.budget_stats
                };
            } else {
                results.by_niche[niche] = { total_jobs: 0 };
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[Upwork Aggregate Daily] [${requestId}] Completed in ${duration}ms`);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                request_id: requestId,
                duration_ms: duration,
                ...results
            })
        };
    } catch (err) {
        console.error(`[Upwork Aggregate Daily] [${requestId}] Error:`, err);

        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Daily aggregation failed',
                message: err.message
            })
        };
    }
};

/**
 * Aggregate job data for a single niche and day
 */
async function aggregateNicheDaily(db, niche, dayStart, dayEnd) {
    const collection = db.collection('upwork_jobs_raw');

    // Base query for this niche and day
    const matchStage = {
        niche,
        fetched_at: { $gte: dayStart, $lt: dayEnd }
    };

    // Get total count
    const totalJobs = await collection.countDocuments(matchStage);

    if (totalJobs === 0) {
        return {
            date: dayStart,
            niche,
            total_jobs: 0,
            by_category: {},
            by_skill: {},
            by_keyword: {},
            by_experience: {},
            by_contract_kind: {},
            budget_stats: { fixed: {}, hourly: {} },
            created_at: new Date()
        };
    }

    // Aggregate by category
    const categoryAgg = await collection.aggregate([
        { $match: matchStage },
        { $group: { _id: '$category', count: { $sum: 1 } } }
    ]).toArray();

    // Aggregate by skill (unwind skills array)
    const skillAgg = await collection.aggregate([
        { $match: matchStage },
        { $unwind: '$skills' },
        { $group: { _id: '$skills', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
    ]).toArray();

    // Aggregate by keyword hit
    const keywordAgg = await collection.aggregate([
        { $match: matchStage },
        { $unwind: '$keywords_hit' },
        { $group: { _id: '$keywords_hit', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]).toArray();

    // Aggregate by experience level
    const expAgg = await collection.aggregate([
        { $match: matchStage },
        { $group: { _id: '$experience_level', count: { $sum: 1 } } }
    ]).toArray();

    // Aggregate by contract kind
    const contractAgg = await collection.aggregate([
        { $match: matchStage },
        { $group: { _id: '$contract_kind', count: { $sum: 1 } } }
    ]).toArray();

    // Budget stats for fixed-price jobs
    const fixedBudgetStats = await collection.aggregate([
        {
            $match: {
                ...matchStage,
                contract_kind: 'fixed',
                budget_min: { $gt: 0 }
            }
        },
        {
            $group: {
                _id: null,
                min: { $min: '$budget_min' },
                max: { $max: '$budget_max' },
                avg: { $avg: '$budget_min' },
                budgets: { $push: '$budget_min' }
            }
        }
    ]).toArray();

    // Budget stats for hourly jobs
    const hourlyBudgetStats = await collection.aggregate([
        {
            $match: {
                ...matchStage,
                contract_kind: 'hourly',
                hourly_rate_min: { $gt: 0 }
            }
        },
        {
            $group: {
                _id: null,
                min: { $min: '$hourly_rate_min' },
                max: { $max: '$hourly_rate_max' },
                avg: { $avg: { $avg: ['$hourly_rate_min', '$hourly_rate_max'] } },
                rates: { $push: { min: '$hourly_rate_min', max: '$hourly_rate_max' } }
            }
        }
    ]).toArray();

    // Calculate median for fixed budgets
    let fixedMedian = null;
    if (fixedBudgetStats.length > 0 && fixedBudgetStats[0].budgets) {
        const sorted = fixedBudgetStats[0].budgets.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        fixedMedian = sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    // Calculate median for hourly rates
    let hourlyMedian = null;
    if (hourlyBudgetStats.length > 0 && hourlyBudgetStats[0].rates) {
        const avgRates = hourlyBudgetStats[0].rates
            .map(r => (r.min + (r.max || r.min)) / 2)
            .sort((a, b) => a - b);
        const mid = Math.floor(avgRates.length / 2);
        hourlyMedian = avgRates.length % 2 !== 0
            ? avgRates[mid]
            : (avgRates[mid - 1] + avgRates[mid]) / 2;
    }

    // Convert arrays to objects
    const byCategory = {};
    categoryAgg.forEach(c => {
        if (c._id) byCategory[c._id] = c.count;
    });

    const bySkill = {};
    skillAgg.forEach(s => {
        if (s._id) bySkill[s._id] = s.count;
    });

    const byKeyword = {};
    keywordAgg.forEach(k => {
        if (k._id) byKeyword[k._id] = k.count;
    });

    const byExperience = {};
    expAgg.forEach(e => {
        if (e._id) byExperience[e._id] = e.count;
    });

    const byContractKind = {};
    contractAgg.forEach(c => {
        if (c._id) byContractKind[c._id] = c.count;
    });

    return {
        date: dayStart,
        niche,
        total_jobs: totalJobs,
        by_category: byCategory,
        by_skill: bySkill,
        by_keyword: byKeyword,
        by_experience: byExperience,
        by_contract_kind: byContractKind,
        budget_stats: {
            fixed: fixedBudgetStats.length > 0 ? {
                min: fixedBudgetStats[0].min,
                max: fixedBudgetStats[0].max,
                avg: Math.round(fixedBudgetStats[0].avg * 100) / 100,
                median: fixedMedian ? Math.round(fixedMedian * 100) / 100 : null,
                count: fixedBudgetStats[0].budgets?.length || 0
            } : {},
            hourly: hourlyBudgetStats.length > 0 ? {
                min: hourlyBudgetStats[0].min,
                max: hourlyBudgetStats[0].max,
                avg: Math.round(hourlyBudgetStats[0].avg * 100) / 100,
                median: hourlyMedian ? Math.round(hourlyMedian * 100) / 100 : null,
                count: hourlyBudgetStats[0].rates?.length || 0
            } : {}
        },
        created_at: new Date()
    };
}
