// /.netlify/functions/api-notification-logs
// API for viewing notification logs with filtering

const {
    getDb,
    createNotificationLogsIndexes
} = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) return authError;

    try {
        const db = await getDb();
        await createNotificationLogsIndexes(db);
        const logsCol = db.collection('notification_logs');

        const params = event.queryStringParameters || {};

        // Build query based on filters
        const query = {};

        if (params.rule_id) {
            query.rule_id = params.rule_id;
        }

        if (params.student_id) {
            query.student_id = params.student_id;
        }

        if (params.status) {
            query.status = params.status;
        }

        if (params.dry_run !== undefined) {
            query.dry_run = params.dry_run === 'true';
        }

        // Date range filtering
        if (params.start_date || params.end_date) {
            query.triggered_at = {};
            if (params.start_date) {
                query.triggered_at.$gte = new Date(params.start_date);
            }
            if (params.end_date) {
                query.triggered_at.$lte = new Date(params.end_date);
            }
        }

        // Pagination
        const limit = parseInt(params.limit || '50', 10);
        const skip = parseInt(params.skip || '0', 10);

        // Get logs
        const logs = await logsCol
            .find(query)
            .sort({ triggered_at: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count for pagination
        const total = await logsCol.countDocuments(query);

        // Get summary stats
        const stats = await logsCol.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const statusCounts = {};
        stats.forEach(s => {
            statusCounts[s._id] = s.count;
        });

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                logs,
                pagination: {
                    total,
                    limit,
                    skip,
                    has_more: skip + logs.length < total
                },
                stats: statusCounts
            })
        };

    } catch (error) {
        console.error('[Notification Logs API] Error:', error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Internal server error',
                details: error.message
            })
        };
    }
};
