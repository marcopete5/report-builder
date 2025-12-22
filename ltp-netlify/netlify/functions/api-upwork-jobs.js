// /.netlify/functions/api-upwork-jobs
// API endpoint to list and search Upwork job postings

const { getDb } = require('./utils/database');
const { requireAuth } = require('./utils/db-auth');
const { getCorsHeaders } = require('./utils/cors');
const { NICHE_FILTERS } = require('./utils/upwork-client');

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

        // Parse query parameters
        const page = Math.max(1, parseInt(q.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(q.limit) || 25));
        const skip = (page - 1) * limit;

        // Build query filters
        const query = {};

        // Niche filter
        if (q.niche) {
            if (!NICHE_FILTERS[q.niche]) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: 'Invalid niche',
                        valid_niches: Object.keys(NICHE_FILTERS)
                    })
                };
            }
            query.niche = q.niche;
        }

        // Date range filter
        if (q.from || q.to) {
            query.fetched_at = {};
            if (q.from) query.fetched_at.$gte = new Date(q.from);
            if (q.to) query.fetched_at.$lte = new Date(q.to);
        }

        // Contract kind filter
        if (q.contract_kind && ['hourly', 'fixed'].includes(q.contract_kind)) {
            query.contract_kind = q.contract_kind;
        }

        // Experience level filter
        if (q.experience_level && ['entry', 'intermediate', 'expert'].includes(q.experience_level)) {
            query.experience_level = q.experience_level;
        }

        // Skill filter
        if (q.skill) {
            query.skills = { $regex: new RegExp(q.skill, 'i') };
        }

        // Keyword filter
        if (q.keyword) {
            query.keywords_hit = { $regex: new RegExp(q.keyword, 'i') };
        }

        // Budget range filter
        if (q.budget_min) {
            query.$or = [
                { budget_min: { $gte: parseFloat(q.budget_min) } },
                { hourly_rate_min: { $gte: parseFloat(q.budget_min) } }
            ];
        }

        // Text search
        if (q.search) {
            query.$or = [
                { title: { $regex: new RegExp(q.search, 'i') } },
                { description: { $regex: new RegExp(q.search, 'i') } }
            ];
        }

        // Sort options
        let sort = { fetched_at: -1 }; // Default: newest first
        if (q.sort === 'budget_desc') sort = { budget_min: -1 };
        if (q.sort === 'budget_asc') sort = { budget_min: 1 };
        if (q.sort === 'published') sort = { published_at: -1 };

        // Execute query
        const [jobs, total] = await Promise.all([
            db.collection('upwork_jobs_raw')
                .find(query)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .project({
                    upwork_id: 1,
                    title: 1,
                    description: 1,
                    published_at: 1,
                    budget_min: 1,
                    budget_max: 1,
                    contract_kind: 1,
                    hourly_rate_min: 1,
                    hourly_rate_max: 1,
                    currency: 1,
                    experience_level: 1,
                    country: 1,
                    category: 1,
                    skills: 1,
                    keywords_hit: 1,
                    niche: 1,
                    fetched_at: 1
                })
                .toArray(),
            db.collection('upwork_jobs_raw').countDocuments(query)
        ]);

        const totalPages = Math.ceil(total / limit);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobs,
                pagination: {
                    page,
                    limit,
                    total,
                    total_pages: totalPages,
                    has_next: page < totalPages,
                    has_prev: page > 1
                },
                filters: {
                    niche: q.niche || null,
                    contract_kind: q.contract_kind || null,
                    experience_level: q.experience_level || null,
                    date_range: (q.from || q.to) ? { from: q.from, to: q.to } : null
                }
            })
        };
    } catch (err) {
        console.error('[API Upwork Jobs] Error:', err);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to fetch jobs', message: err.message })
        };
    }
};
