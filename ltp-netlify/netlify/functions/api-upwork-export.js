// /.netlify/functions/api-upwork-export
// Export Upwork job data as CSV or JSON

const { getDb } = require('./utils/database');
const { requireAdmin } = require('./utils/db-auth');
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

    // Require admin authentication for exports
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const db = await getDb();
        const q = event.queryStringParameters || {};

        const format = q.format || 'json'; // 'json' or 'csv'
        const type = q.type || 'jobs'; // 'jobs', 'skills', 'patterns', or 'assignments'

        // Build date filter
        const days = Math.min(90, Math.max(1, parseInt(q.days) || 7));
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

        const baseQuery = { fetched_at: { $gte: startDate, $lte: endDate } };
        if (q.niche && NICHE_FILTERS[q.niche]) {
            baseQuery.niche = q.niche;
        }

        let data;
        let filename;

        switch (type) {
            case 'skills':
                data = await exportSkills(db, baseQuery);
                filename = `upwork-skills-${formatDate(new Date())}`;
                break;

            case 'patterns':
                data = await exportPatterns(db, q.niche);
                filename = `upwork-patterns-${formatDate(new Date())}`;
                break;

            case 'assignments':
                data = await exportAssignments(db, baseQuery);
                filename = `upwork-assignments-${formatDate(new Date())}`;
                break;

            default:
                data = await exportJobs(db, baseQuery);
                filename = `upwork-jobs-${formatDate(new Date())}`;
        }

        if (format === 'csv') {
            const csv = convertToCSV(data);
            return {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="${filename}.csv"`
                },
                body: csv
            };
        } else {
            return {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Content-Disposition': `attachment; filename="${filename}.json"`
                },
                body: JSON.stringify(data, null, 2)
            };
        }
    } catch (err) {
        console.error('[API Upwork Export] Error:', err);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Export failed', message: err.message })
        };
    }
};

/**
 * Export raw job data
 */
async function exportJobs(db, query) {
    const jobs = await db.collection('upwork_jobs_raw')
        .find(query)
        .sort({ fetched_at: -1 })
        .limit(1000)
        .project({
            _id: 0,
            upwork_id: 1,
            title: 1,
            niche: 1,
            contract_kind: 1,
            budget_min: 1,
            budget_max: 1,
            hourly_rate_min: 1,
            hourly_rate_max: 1,
            currency: 1,
            experience_level: 1,
            country: 1,
            category: 1,
            skills: 1,
            keywords_hit: 1,
            published_at: 1,
            fetched_at: 1
        })
        .toArray();

    return jobs.map(job => ({
        ...job,
        skills: (job.skills || []).join(', '),
        keywords_hit: (job.keywords_hit || []).join(', '),
        published_at: job.published_at ? job.published_at.toISOString() : '',
        fetched_at: job.fetched_at ? job.fetched_at.toISOString() : ''
    }));
}

/**
 * Export skill frequency data
 */
async function exportSkills(db, query) {
    const skills = await db.collection('upwork_jobs_raw').aggregate([
        { $match: query },
        { $unwind: '$skills' },
        {
            $group: {
                _id: { skill: '$skills', niche: '$niche' },
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } },
        { $limit: 500 }
    ]).toArray();

    return skills.map(s => ({
        skill: s._id.skill,
        niche: s._id.niche,
        count: s.count
    }));
}

/**
 * Export repeated patterns/asks from weekly aggregates
 */
async function exportPatterns(db, niche) {
    const query = niche && NICHE_FILTERS[niche] ? { niche } : {};

    const weeklies = await db.collection('upwork_aggregates_weekly')
        .find(query)
        .sort({ week_start: -1 })
        .limit(4)
        .toArray();

    const patterns = [];

    for (const weekly of weeklies) {
        const weekStr = weekly.week_start.toISOString().split('T')[0];

        // Add n-grams
        for (const ngram of (weekly.top_ngrams || []).slice(0, 20)) {
            patterns.push({
                week: weekStr,
                niche: weekly.niche,
                type: 'ngram',
                pattern: ngram.ngram,
                count: ngram.count,
                examples: ''
            });
        }

        // Add repeated asks
        for (const ask of (weekly.repeated_asks || [])) {
            patterns.push({
                week: weekStr,
                niche: weekly.niche,
                type: 'repeated_ask',
                pattern: ask.pattern,
                count: ask.count,
                examples: (ask.examples || []).join(' | ')
            });
        }
    }

    return patterns;
}

/**
 * Export data formatted for faculty assignments/backlogs
 */
async function exportAssignments(db, query) {
    // Get jobs with full descriptions
    const jobs = await db.collection('upwork_jobs_raw')
        .find(query)
        .sort({ fetched_at: -1 })
        .limit(100)
        .project({
            _id: 0,
            title: 1,
            description: 1,
            niche: 1,
            skills: 1,
            keywords_hit: 1,
            budget_min: 1,
            hourly_rate_min: 1,
            hourly_rate_max: 1,
            experience_level: 1
        })
        .toArray();

    // Format as assignment suggestions
    return jobs.map((job, index) => {
        // Extract key requirements from description
        const descSnippet = (job.description || '')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .slice(0, 300);

        return {
            assignment_id: index + 1,
            suggested_title: cleanTitle(job.title),
            niche: job.niche,
            difficulty: mapExperienceTodifficulty(job.experience_level),
            skills_required: (job.skills || []).slice(0, 5).join(', '),
            keywords: (job.keywords_hit || []).join(', '),
            budget_reference: formatBudget(job),
            description_snippet: descSnippet,
            real_world_context: `Based on real Upwork job posting: "${job.title}"`
        };
    });
}

/**
 * Clean job title for assignment use
 */
function cleanTitle(title) {
    if (!title) return 'Project Assignment';

    return title
        .replace(/urgent/gi, '')
        .replace(/asap/gi, '')
        .replace(/needed/gi, '')
        .replace(/looking for/gi, '')
        .replace(/need/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Map experience level to assignment difficulty
 */
function mapExperienceTodifficulty(level) {
    const map = {
        'entry': 'Beginner',
        'intermediate': 'Intermediate',
        'expert': 'Advanced'
    };
    return map[level] || 'Intermediate';
}

/**
 * Format budget for display
 */
function formatBudget(job) {
    if (job.budget_min) {
        return `$${job.budget_min} fixed`;
    }
    if (job.hourly_rate_min && job.hourly_rate_max) {
        return `$${job.hourly_rate_min}-${job.hourly_rate_max}/hr`;
    }
    if (job.hourly_rate_min) {
        return `$${job.hourly_rate_min}/hr`;
    }
    return 'Not specified';
}

/**
 * Convert data array to CSV format
 */
function convertToCSV(data) {
    if (!data || data.length === 0) {
        return '';
    }

    const headers = Object.keys(data[0]);

    const escapeField = (field) => {
        if (field === null || field === undefined) return '';
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const rows = [
        headers.join(','),
        ...data.map(row => headers.map(h => escapeField(row[h])).join(','))
    ];

    return rows.join('\n');
}

/**
 * Format date for filename
 */
function formatDate(date) {
    return date.toISOString().split('T')[0];
}
