// /.netlify/functions/upwork-jobs-sync-manual
// Manual trigger for Upwork job sync with optional parameters

const { requireAdmin } = require('./utils/db-auth');
const { getCorsHeaders } = require('./utils/cors');
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
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    const startTime = Date.now();
    const requestId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Upwork Sync Manual] [${requestId}] Starting manual sync`);

    try {
        // Parse query parameters
        const q = event.queryStringParameters || {};
        const selectedNiche = q.niche; // Optional: filter to specific niche
        const maxJobs = Math.min(parseInt(q.max_jobs) || 100, 500); // Default 100, max 500
        const dryRun = q.dry_run === 'true'; // If true, don't store to DB

        // Check token status
        const tokenStatus = await getTokenStatus();
        if (tokenStatus.status === 'missing' || tokenStatus.status === 'expired') {
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

        // Validate niche if provided
        const nichesToProcess = selectedNiche
            ? [selectedNiche]
            : Object.keys(NICHE_FILTERS);

        if (selectedNiche && !NICHE_FILTERS[selectedNiche]) {
            return {
                statusCode: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Invalid niche',
                    valid_niches: Object.keys(NICHE_FILTERS)
                })
            };
        }

        // Ensure indexes exist
        if (!dryRun) {
            await createUpworkIndexes();
        }

        const db = dryRun ? null : await getDb();
        const stats = {
            request_id: requestId,
            dry_run: dryRun,
            max_jobs_per_niche: maxJobs,
            niches_processed: nichesToProcess,
            total_fetched: 0,
            total_matched: 0,
            total_stored: 0,
            total_duplicates: 0,
            by_niche: {},
            sample_jobs: [],
            errors: []
        };

        // Process each niche
        for (const niche of nichesToProcess) {
            console.log(`[Upwork Sync Manual] [${requestId}] Processing niche: ${niche}`);

            const nicheStats = await processNicheManual(db, niche, maxJobs, dryRun, requestId);
            stats.by_niche[niche] = nicheStats;
            stats.total_fetched += nicheStats.fetched;
            stats.total_matched += nicheStats.matched;
            stats.total_stored += nicheStats.stored;
            stats.total_duplicates += nicheStats.duplicates;

            // Add sample jobs (first 3 per niche)
            if (nicheStats.samples) {
                stats.sample_jobs.push(...nicheStats.samples.map(s => ({
                    ...s,
                    niche
                })));
            }

            if (nicheStats.error) {
                stats.errors.push({ niche, error: nicheStats.error });
            }

            // Small delay between niches
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        const duration = Date.now() - startTime;
        stats.duration_ms = duration;

        console.log(`[Upwork Sync Manual] [${requestId}] Completed in ${duration}ms`);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                ...stats
            })
        };
    } catch (err) {
        const duration = Date.now() - startTime;
        console.error(`[Upwork Sync Manual] [${requestId}] Failed:`, err);

        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Manual sync failed',
                request_id: requestId,
                message: err.message,
                duration_ms: duration
            })
        };
    }
};

/**
 * Process a single niche with manual settings
 */
async function processNicheManual(db, niche, maxJobs, dryRun, requestId) {
    const filters = NICHE_FILTERS[niche];
    const nicheStats = {
        fetched: 0,
        matched: 0,
        stored: 0,
        duplicates: 0,
        pages: 0,
        samples: [],
        error: null
    };

    try {
        const searchQuery = filters.include.slice(0, 5).join(' OR ');

        let cursor = null;
        let hasMore = true;
        const matchedJobs = [];

        // Paginate through results
        while (hasMore && nicheStats.fetched < maxJobs) {
            await waitForRateLimit();
            nicheStats.pages++;

            const result = await searchJobPostings(searchQuery, 50, cursor);
            const searchData = result.marketplaceJobPostingsSearch;

            if (!searchData || !searchData.edges) {
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

            hasMore = searchData.pageInfo?.hasNextPage && searchData.edges.length > 0;
            cursor = searchData.pageInfo?.endCursor;

            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        // Get sample jobs (first 3 matched)
        nicheStats.samples = matchedJobs.slice(0, 3).map(j => ({
            id: j.id,
            title: j.title,
            keywords_hit: j.keywords_hit,
            budget: j.budget?.amount,
            hourly_rate: j.hourlyBudget ? `${j.hourlyBudget.min}-${j.hourlyBudget.max}` : null,
            skills: (j.skills || []).slice(0, 5).map(s => s.name)
        }));

        // Store jobs if not dry run
        if (!dryRun && db && matchedJobs.length > 0) {
            // Hydrate descriptions for matched jobs
            const hydratedJobs = await hydrateJobDescriptions(matchedJobs, requestId);

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
                    }
                }
            }
        }

    } catch (err) {
        console.error(`[Upwork Sync Manual] [${requestId}] [${niche}] Error:`, err.message);
        nicheStats.error = err.message;
    }

    return nicheStats;
}

/**
 * Hydrate job descriptions
 */
async function hydrateJobDescriptions(jobs, requestId) {
    if (jobs.length === 0) return [];

    const hydratedJobs = [...jobs];
    const jobIds = jobs.map(j => j.id);
    const BATCH_SIZE = 25;

    for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
        const batchIds = jobIds.slice(i, i + BATCH_SIZE);

        try {
            await waitForRateLimit();

            const contentResult = await getJobPostingContent(batchIds);
            const contents = contentResult.marketplaceJobPostingsContents || [];

            for (const content of contents) {
                const jobIndex = hydratedJobs.findIndex(j => j.id === content.id);
                if (jobIndex !== -1) {
                    hydratedJobs[jobIndex].description = content.description;
                }
            }
        } catch (err) {
            console.warn(`[Upwork Sync Manual] [${requestId}] Content error:`, err.message);
        }

        if (i + BATCH_SIZE < jobIds.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    return hydratedJobs;
}

/**
 * Normalize job data
 */
function normalizeJob(job, niche) {
    const budget = job.budget || {};
    const hourlyBudget = job.hourlyBudget || {};

    let contractKind = 'unknown';
    if (job.jobType === 'HOURLY' || hourlyBudget.min || hourlyBudget.max) {
        contractKind = 'hourly';
    } else if (job.jobType === 'FIXED' || budget.amount) {
        contractKind = 'fixed';
    }

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
