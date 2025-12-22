// /.netlify/functions/upwork-aggregate-weekly
// Weekly aggregation with n-gram extraction and trend analysis
// Schedule: Sundays at 6 AM UTC

const { getDb } = require('./utils/database');
const { NICHE_FILTERS } = require('./utils/upwork-client');
const { getCorsHeaders } = require('./utils/cors');

// Common stop words to filter from n-grams
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his',
    'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
    'who', 'what', 'which', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just',
    'also', 'now', 'here', 'there', 'then', 'if', 'about', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'under', 'again', 'further', 'once', 'any', 'am', 'being', 'able',
    'looking', 'looking for', 'need', 'needed', 'want', 'wanted', 'seeking',
    'please', 'required', 'experience', 'work', 'project', 'job', 'help'
]);

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,OPTIONS');
    const startTime = Date.now();
    const requestId = `agg-weekly-${Date.now()}`;

    const isScheduled = event.headers['x-nf-event'] === 'schedule';
    console.log(`[Upwork Aggregate Weekly] [${requestId}] Starting (scheduled: ${isScheduled})`);

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

        // Calculate week boundaries (Monday to Sunday)
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

        // Default to last week
        let weekStart;
        if (q.week_start) {
            weekStart = new Date(q.week_start);
        } else {
            weekStart = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() - daysFromMonday - 7,
                0, 0, 0, 0
            ));
        }

        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Prior week for comparison
        const priorWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        const priorWeekEnd = weekStart;

        console.log(`[Upwork Aggregate Weekly] [${requestId}] Week: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`);

        const results = {
            week_start: weekStart,
            week_end: weekEnd,
            aggregates_created: 0,
            by_niche: {}
        };

        // Process each niche
        for (const niche of Object.keys(NICHE_FILTERS)) {
            const aggregate = await aggregateNicheWeekly(
                db, niche,
                weekStart, weekEnd,
                priorWeekStart, priorWeekEnd
            );

            if (aggregate.total_jobs > 0) {
                // Store aggregate
                await db.collection('upwork_aggregates_weekly').updateOne(
                    { week_start: weekStart, niche },
                    { $set: aggregate },
                    { upsert: true }
                );

                results.aggregates_created++;
                results.by_niche[niche] = {
                    total_jobs: aggregate.total_jobs,
                    top_skills: aggregate.top_skills.slice(0, 5),
                    top_ngrams: aggregate.top_ngrams.slice(0, 5),
                    repeated_asks: aggregate.repeated_asks.slice(0, 3)
                };
            } else {
                results.by_niche[niche] = { total_jobs: 0 };
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[Upwork Aggregate Weekly] [${requestId}] Completed in ${duration}ms`);

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
        console.error(`[Upwork Aggregate Weekly] [${requestId}] Error:`, err);

        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Weekly aggregation failed',
                message: err.message
            })
        };
    }
};

/**
 * Aggregate job data for a single niche and week
 */
async function aggregateNicheWeekly(db, niche, weekStart, weekEnd, priorWeekStart, priorWeekEnd) {
    const collection = db.collection('upwork_jobs_raw');

    // Current week match
    const currentMatch = {
        niche,
        fetched_at: { $gte: weekStart, $lt: weekEnd }
    };

    // Prior week match
    const priorMatch = {
        niche,
        fetched_at: { $gte: priorWeekStart, $lt: priorWeekEnd }
    };

    // Get total counts
    const totalJobs = await collection.countDocuments(currentMatch);
    const priorTotalJobs = await collection.countDocuments(priorMatch);

    if (totalJobs === 0) {
        return {
            week_start: weekStart,
            week_end: weekEnd,
            niche,
            total_jobs: 0,
            total_jobs_prior: priorTotalJobs,
            top_skills: [],
            top_keywords: [],
            top_ngrams: [],
            budget_trends: {},
            repeated_asks: [],
            created_at: new Date()
        };
    }

    // Get current week skills
    const currentSkills = await collection.aggregate([
        { $match: currentMatch },
        { $unwind: '$skills' },
        { $group: { _id: '$skills', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
    ]).toArray();

    // Get prior week skills for comparison
    const priorSkillsMap = {};
    const priorSkills = await collection.aggregate([
        { $match: priorMatch },
        { $unwind: '$skills' },
        { $group: { _id: '$skills', count: { $sum: 1 } } }
    ]).toArray();
    priorSkills.forEach(s => { priorSkillsMap[s._id] = s.count; });

    // Calculate skill trends
    const topSkills = currentSkills.map(s => ({
        skill: s._id,
        count: s.count,
        prior_count: priorSkillsMap[s._id] || 0,
        change: s.count - (priorSkillsMap[s._id] || 0),
        change_pct: priorSkillsMap[s._id]
            ? Math.round(((s.count - priorSkillsMap[s._id]) / priorSkillsMap[s._id]) * 100)
            : null
    }));

    // Get current week keywords
    const currentKeywords = await collection.aggregate([
        { $match: currentMatch },
        { $unwind: '$keywords_hit' },
        { $group: { _id: '$keywords_hit', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
    ]).toArray();

    // Get prior week keywords
    const priorKeywordsMap = {};
    const priorKeywords = await collection.aggregate([
        { $match: priorMatch },
        { $unwind: '$keywords_hit' },
        { $group: { _id: '$keywords_hit', count: { $sum: 1 } } }
    ]).toArray();
    priorKeywords.forEach(k => { priorKeywordsMap[k._id] = k.count; });

    const topKeywords = currentKeywords.map(k => ({
        keyword: k._id,
        count: k.count,
        prior_count: priorKeywordsMap[k._id] || 0,
        change: k.count - (priorKeywordsMap[k._id] || 0)
    }));

    // Extract n-grams from job titles and descriptions
    const jobs = await collection.find(currentMatch)
        .project({ title: 1, description: 1 })
        .limit(500)
        .toArray();

    const ngrams = extractNgrams(jobs);
    const topNgrams = ngrams.slice(0, 30);

    // Identify repeated asks (patterns appearing 3+ times)
    const repeatedAsks = identifyRepeatedAsks(jobs, ngrams);

    // Budget trends
    const currentBudgets = await getBudgetStats(collection, currentMatch);
    const priorBudgets = await getBudgetStats(collection, priorMatch);

    return {
        week_start: weekStart,
        week_end: weekEnd,
        niche,
        total_jobs: totalJobs,
        total_jobs_prior: priorTotalJobs,
        total_jobs_change: totalJobs - priorTotalJobs,
        top_skills: topSkills,
        top_keywords: topKeywords,
        top_ngrams: topNgrams,
        budget_trends: {
            fixed_avg: currentBudgets.fixed_avg,
            fixed_avg_prior: priorBudgets.fixed_avg,
            fixed_change: currentBudgets.fixed_avg && priorBudgets.fixed_avg
                ? Math.round((currentBudgets.fixed_avg - priorBudgets.fixed_avg) * 100) / 100
                : null,
            hourly_avg: currentBudgets.hourly_avg,
            hourly_avg_prior: priorBudgets.hourly_avg,
            hourly_change: currentBudgets.hourly_avg && priorBudgets.hourly_avg
                ? Math.round((currentBudgets.hourly_avg - priorBudgets.hourly_avg) * 100) / 100
                : null
        },
        repeated_asks: repeatedAsks,
        created_at: new Date()
    };
}

/**
 * Extract 2-3 word n-grams from job titles and descriptions
 */
function extractNgrams(jobs) {
    const ngramCounts = {};

    for (const job of jobs) {
        const text = `${job.title || ''} ${(job.description || '').slice(0, 500)}`;
        const words = text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w));

        // Extract 2-grams
        for (let i = 0; i < words.length - 1; i++) {
            const bigram = `${words[i]} ${words[i + 1]}`;
            if (!containsStopWord(bigram)) {
                ngramCounts[bigram] = (ngramCounts[bigram] || 0) + 1;
            }
        }

        // Extract 3-grams
        for (let i = 0; i < words.length - 2; i++) {
            const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
            if (!containsStopWord(trigram)) {
                ngramCounts[trigram] = (ngramCounts[trigram] || 0) + 1;
            }
        }
    }

    // Sort by count and filter low-frequency
    return Object.entries(ngramCounts)
        .filter(([_, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .map(([ngram, count]) => ({ ngram, count }));
}

/**
 * Check if n-gram contains stop words
 */
function containsStopWord(ngram) {
    const words = ngram.split(' ');
    return words.some(w => STOP_WORDS.has(w));
}

/**
 * Identify repeated asks (common patterns in job requests)
 */
function identifyRepeatedAsks(jobs, ngrams) {
    const repeatedAsks = [];

    // Use top n-grams as patterns
    const topPatterns = ngrams.slice(0, 20);

    for (const { ngram, count } of topPatterns) {
        if (count < 3) continue;

        // Find example jobs containing this pattern
        const examples = jobs
            .filter(j => {
                const text = `${j.title || ''} ${j.description || ''}`.toLowerCase();
                return text.includes(ngram);
            })
            .slice(0, 3)
            .map(j => j.title);

        if (examples.length >= 2) {
            repeatedAsks.push({
                pattern: ngram,
                count,
                examples: examples.filter(Boolean)
            });
        }

        if (repeatedAsks.length >= 10) break;
    }

    return repeatedAsks;
}

/**
 * Get budget statistics for a query
 */
async function getBudgetStats(collection, match) {
    const fixedStats = await collection.aggregate([
        { $match: { ...match, contract_kind: 'fixed', budget_min: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$budget_min' } } }
    ]).toArray();

    const hourlyStats = await collection.aggregate([
        { $match: { ...match, contract_kind: 'hourly', hourly_rate_min: { $gt: 0 } } },
        {
            $group: {
                _id: null,
                avg: { $avg: { $avg: ['$hourly_rate_min', '$hourly_rate_max'] } }
            }
        }
    ]).toArray();

    return {
        fixed_avg: fixedStats.length > 0 ? Math.round(fixedStats[0].avg * 100) / 100 : null,
        hourly_avg: hourlyStats.length > 0 ? Math.round(hourlyStats[0].avg * 100) / 100 : null
    };
}
