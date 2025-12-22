// /.netlify/functions/upwork-jobs-sync
// Daily scheduled job to ingest Upwork job postings
// Schedule: 5 AM UTC (configured in netlify.toml)

const { getDb } = require('./utils/database');
const {
    searchJobPostings,
    getJobPostingContent,
    NICHE_FILTERS,
    matchesNicheFilters,
    getTokenStatus,
    createUpworkIndexes,
    waitForRateLimit
} = require('./utils/upwork-client');
const { getCorsHeaders } = require('./utils/cors');

// Maximum jobs to fetch per niche per run
const MAX_JOBS_PER_NICHE = 500;
// Batch size for content hydration
const CONTENT_BATCH_SIZE = 25;
// Delay between batches (ms) for rate limiting
const BATCH_DELAY_MS = 250;

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,OPTIONS');
    const startTime = Date.now();
    const requestId = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Check if this is a scheduled invocation
    const isScheduled = event.headers['x-nf-event'] === 'schedule';

    console.log(`[Upwork Sync] [${requestId}] Starting job sync (scheduled: ${isScheduled})`);

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        // Check token status
        const tokenStatus = await getTokenStatus();
        if (tokenStatus.status === 'missing' || tokenStatus.status === 'expired') {
            console.error(`[Upwork Sync] [${requestId}] Token issue:`, tokenStatus.message);
            return {
                statusCode: 503,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Upwork API not authorized',
                    details: tokenStatus.message,
                    action: 'Please complete OAuth authorization at /api/upwork-oauth-init'
                })
            };
        }

        if (tokenStatus.status === 'expiring_soon') {
            console.warn(`[Upwork Sync] [${requestId}] Token expiring soon:`, tokenStatus.expires_in_hours, 'hours');
        }

        // Ensure indexes exist
        await createUpworkIndexes();

        const db = await getDb();
        const stats = {
            total_fetched: 0,
            total_matched: 0,
            total_stored: 0,
            total_duplicates: 0,
            by_niche: {},
            errors: []
        };

        // Process each niche
        for (const niche of Object.keys(NICHE_FILTERS)) {
            console.log(`[Upwork Sync] [${requestId}] Processing niche: ${niche}`);

            const nicheStats = await processNiche(db, niche, requestId);
            stats.by_niche[niche] = nicheStats;
            stats.total_fetched += nicheStats.fetched;
            stats.total_matched += nicheStats.matched;
            stats.total_stored += nicheStats.stored;
            stats.total_duplicates += nicheStats.duplicates;

            if (nicheStats.error) {
                stats.errors.push({ niche, error: nicheStats.error });
            }

            // Small delay between niches
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Update sync state
        await db.collection('upwork_sync_state').updateOne(
            { type: 'daily_sync' },
            {
                $set: {
                    last_run: new Date(),
                    last_stats: stats,
                    request_id: requestId
                }
            },
            { upsert: true }
        );

        const duration = Date.now() - startTime;
        console.log(`[Upwork Sync] [${requestId}] Completed in ${duration}ms`);
        console.log(`[Upwork Sync] [${requestId}] Stats:`, JSON.stringify(stats, null, 2));

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                request_id: requestId,
                duration_ms: duration,
                stats
            })
        };
    } catch (err) {
        const duration = Date.now() - startTime;
        console.error(`[Upwork Sync] [${requestId}] Failed after ${duration}ms:`, err);

        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Job sync failed',
                request_id: requestId,
                message: err.message,
                duration_ms: duration
            })
        };
    }
};

/**
 * Process a single niche - search, filter, hydrate, store
 */
async function processNiche(db, niche, requestId) {
    const filters = NICHE_FILTERS[niche];
    const nicheStats = {
        fetched: 0,
        matched: 0,
        stored: 0,
        duplicates: 0,
        pages: 0,
        error: null
    };

    try {
        // Build search query from include keywords
        // Use OR-style search with main keywords
        const searchQuery = filters.include.slice(0, 5).join(' OR ');

        let cursor = null;
        let hasMore = true;
        const matchedJobs = [];

        // Paginate through results
        while (hasMore && nicheStats.fetched < MAX_JOBS_PER_NICHE) {
            await waitForRateLimit();
            nicheStats.pages++;

            console.log(`[Upwork Sync] [${requestId}] [${niche}] Fetching page ${nicheStats.pages}`);

            const result = await searchJobPostings(searchQuery, 50, cursor);
            const searchData = result.marketplaceJobPostingsSearch;

            if (!searchData || !searchData.edges) {
                console.warn(`[Upwork Sync] [${requestId}] [${niche}] No results on page ${nicheStats.pages}`);
                break;
            }

            nicheStats.fetched += searchData.edges.length;

            // Filter jobs by niche keywords
            for (const edge of searchData.edges) {
                const job = edge.node;
                const textToSearch = `${job.title} ${(job.skills || []).map(s => s.name).join(' ')}`;

                const matchResult = matchesNicheFilters(textToSearch, niche);

                if (matchResult.matches) {
                    matchedJobs.push({
                        ...job,
                        cursor: edge.cursor,
                        keywords_hit: matchResult.keywords
                    });
                    nicheStats.matched++;
                }
            }

            // Check for more pages
            hasMore = searchData.pageInfo?.hasNextPage && searchData.edges.length > 0;
            cursor = searchData.pageInfo?.endCursor;

            // Delay between pages
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }

        console.log(`[Upwork Sync] [${requestId}] [${niche}] Matched ${nicheStats.matched} of ${nicheStats.fetched} jobs`);

        // Hydrate job descriptions in batches
        const hydratedJobs = await hydrateJobDescriptions(matchedJobs, requestId, niche);

        // Store jobs in database
        for (const job of hydratedJobs) {
            try {
                const normalizedJob = normalizeJob(job, niche);

                const result = await db.collection('upwork_jobs_raw').updateOne(
                    { upwork_id: normalizedJob.upwork_id },
                    {
                        $set: normalizedJob,
                        $setOnInsert: { first_seen_at: new Date() }
                    },
                    { upsert: true }
                );

                if (result.upsertedCount > 0) {
                    nicheStats.stored++;
                } else {
                    nicheStats.duplicates++;
                }
            } catch (err) {
                if (err.code === 11000) {
                    nicheStats.duplicates++;
                } else {
                    console.error(`[Upwork Sync] [${requestId}] Error storing job:`, err.message);
                }
            }
        }

        console.log(`[Upwork Sync] [${requestId}] [${niche}] Stored ${nicheStats.stored} new jobs, ${nicheStats.duplicates} duplicates`);

    } catch (err) {
        console.error(`[Upwork Sync] [${requestId}] [${niche}] Error:`, err.message);
        nicheStats.error = err.message;
    }

    return nicheStats;
}

/**
 * Hydrate job descriptions via content API
 */
async function hydrateJobDescriptions(jobs, requestId, niche) {
    if (jobs.length === 0) return [];

    const hydratedJobs = [...jobs];
    const jobIds = jobs.map(j => j.id);

    // Process in batches
    for (let i = 0; i < jobIds.length; i += CONTENT_BATCH_SIZE) {
        const batchIds = jobIds.slice(i, i + CONTENT_BATCH_SIZE);

        try {
            await waitForRateLimit();

            const contentResult = await getJobPostingContent(batchIds);
            const contents = contentResult.marketplaceJobPostingsContents || [];

            // Map descriptions to jobs
            for (const content of contents) {
                const jobIndex = hydratedJobs.findIndex(j => j.id === content.id);
                if (jobIndex !== -1) {
                    hydratedJobs[jobIndex].description = content.description;
                }
            }

            console.log(`[Upwork Sync] [${requestId}] [${niche}] Hydrated batch ${Math.floor(i / CONTENT_BATCH_SIZE) + 1}`);
        } catch (err) {
            console.warn(`[Upwork Sync] [${requestId}] [${niche}] Content hydration error:`, err.message);
        }

        // Delay between batches
        if (i + CONTENT_BATCH_SIZE < jobIds.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }

    return hydratedJobs;
}

/**
 * Normalize job data for storage
 */
function normalizeJob(job, niche) {
    const budget = job.budget || {};
    const hourlyBudget = job.hourlyBudget || {};

    // Determine contract kind
    let contractKind = 'unknown';
    if (job.jobType === 'HOURLY' || hourlyBudget.min || hourlyBudget.max) {
        contractKind = 'hourly';
    } else if (job.jobType === 'FIXED' || budget.amount) {
        contractKind = 'fixed';
    }

    // Map experience level
    const expLevelMap = {
        'ENTRY_LEVEL': 'entry',
        'INTERMEDIATE': 'intermediate',
        'EXPERT': 'expert'
    };

    return {
        upwork_id: job.id,
        title: job.title,
        description: job.description || '',
        published_at: job.publishedDateTime ? new Date(job.publishedDateTime) : null,
        budget_min: budget.amount ? parseFloat(budget.amount) : null,
        budget_max: budget.amount ? parseFloat(budget.amount) : null,
        contract_kind: contractKind,
        hourly_rate_min: hourlyBudget.min ? parseFloat(hourlyBudget.min) : null,
        hourly_rate_max: hourlyBudget.max ? parseFloat(hourlyBudget.max) : null,
        currency: budget.currencyCode || hourlyBudget.currencyCode || 'USD',
        experience_level: expLevelMap[job.contractorTier] || job.contractorTier || 'unknown',
        country: job.client?.location?.country || null,
        category: job.category?.name || null,
        subcategory: job.category?.parentCategory?.name || null,
        skills: (job.skills || []).map(s => s.name),
        keywords_hit: job.keywords_hit || [],
        niche: niche,
        fetched_at: new Date(),
        source_cursor: job.cursor || null
    };
}
