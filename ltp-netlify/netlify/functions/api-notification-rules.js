// /.netlify/functions/api-notification-rules
// API for managing notification rules
// GET, POST, PUT, DELETE operations

const {
    getDb,
    createNotificationRulesIndexes
} = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,PUT,DELETE,PATCH,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) return authError;

    try {
        const db = await getDb();
        await createNotificationRulesIndexes(db);
        const rulesCol = db.collection('notification_rules');

        const { httpMethod, queryStringParameters } = event;
        const ruleId = queryStringParameters?.id;

        // GET - List all rules or get one by ID
        if (httpMethod === 'GET') {
            if (ruleId) {
                // Get single rule
                const rule = await rulesCol.findOne({ id: ruleId });
                if (!rule) {
                    return {
                        statusCode: 404,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'Rule not found' })
                    };
                }
                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify(rule)
                };
            } else {
                // List all rules
                const rules = await rulesCol.find({})
                    .sort({ created_at: -1 })
                    .toArray();
                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rules })
                };
            }
        }

        // POST - Create new rule
        if (httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const {
                id, name, description, enabled, trigger_type, schedule,
                filters, condition, actions, cooldown, created_by
            } = body;

            // Validation
            if (!id || !name || !condition || !actions) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: 'Missing required fields: id, name, condition, actions'
                    })
                };
            }

            // Check if rule with this ID already exists
            const existing = await rulesCol.findOne({ id });
            if (existing) {
                return {
                    statusCode: 409,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule with this ID already exists' })
                };
            }

            const newRule = {
                id,
                name,
                description: description || '',
                enabled: enabled !== undefined ? enabled : true,
                trigger_type: trigger_type || 'scheduled',
                schedule: schedule || 'daily',
                filters: filters || {
                    student_status: [],
                    courses: [],
                    institutions: [],
                    exclude_students: []
                },
                condition,
                actions,
                cooldown: cooldown || { enabled: false, days: 7, type: 'per_student' },
                created_at: new Date(),
                created_by: created_by || 'admin',
                updated_at: new Date(),
                last_run_at: null,
                stats: {
                    total_triggered: 0,
                    total_sent: 0,
                    last_triggered_count: 0
                }
            };

            await rulesCol.insertOne(newRule);

            return {
                statusCode: 201,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Rule created successfully',
                    rule: newRule
                })
            };
        }

        // PUT - Update existing rule
        if (httpMethod === 'PUT') {
            if (!ruleId) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule ID required in query params' })
                };
            }

            const body = JSON.parse(event.body || '{}');
            const {
                name, description, enabled, trigger_type, schedule,
                filters, condition, actions, cooldown
            } = body;

            const updates = {
                updated_at: new Date()
            };

            if (name) updates.name = name;
            if (description !== undefined) updates.description = description;
            if (enabled !== undefined) updates.enabled = enabled;
            if (trigger_type) updates.trigger_type = trigger_type;
            if (schedule) updates.schedule = schedule;
            if (filters) updates.filters = filters;
            if (condition) updates.condition = condition;
            if (actions) updates.actions = actions;
            if (cooldown) updates.cooldown = cooldown;

            const result = await rulesCol.updateOne(
                { id: ruleId },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return {
                    statusCode: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule not found' })
                };
            }

            const updated = await rulesCol.findOne({ id: ruleId });

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Rule updated successfully',
                    rule: updated
                })
            };
        }

        // PATCH - Partial update (e.g., toggle enabled status)
        if (httpMethod === 'PATCH') {
            if (!ruleId) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule ID required in query params' })
                };
            }

            const body = JSON.parse(event.body || '{}');

            const result = await rulesCol.updateOne(
                { id: ruleId },
                { $set: { ...body, updated_at: new Date() } }
            );

            if (result.matchedCount === 0) {
                return {
                    statusCode: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule not found' })
                };
            }

            const updated = await rulesCol.findOne({ id: ruleId });

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Rule updated successfully',
                    rule: updated
                })
            };
        }

        // DELETE - Delete rule
        if (httpMethod === 'DELETE') {
            if (!ruleId) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule ID required in query params' })
                };
            }

            const result = await rulesCol.deleteOne({ id: ruleId });

            if (result.deletedCount === 0) {
                return {
                    statusCode: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Rule not found' })
                };
            }

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Rule deleted successfully' })
            };
        }

        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('[Notification Rules API] Error:', error);
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
