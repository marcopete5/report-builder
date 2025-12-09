// /.netlify/functions/api-email-templates
// API for managing email templates
// GET, POST, PUT, DELETE operations

const {
    getDb,
    createEmailTemplatesIndexes
} = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,PUT,DELETE,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) return authError;

    try {
        const db = await getDb();
        await createEmailTemplatesIndexes(db);
        const templatesCol = db.collection('email_templates');

        const { httpMethod, queryStringParameters } = event;
        const templateId = queryStringParameters?.id;

        // GET - List all templates or get one by ID
        if (httpMethod === 'GET') {
            if (templateId) {
                // Get single template
                const template = await templatesCol.findOne({ id: templateId });
                if (!template) {
                    return {
                        statusCode: 404,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'Template not found' })
                    };
                }
                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify(template)
                };
            } else {
                // List all templates
                const templates = await templatesCol.find({})
                    .sort({ created_at: -1 })
                    .toArray();
                return {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ templates })
                };
            }
        }

        // POST - Create new template
        if (httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const { id, name, subject, html_body, text_body, available_variables } = body;

            // Validation
            if (!id || !name || !subject || !html_body) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: 'Missing required fields: id, name, subject, html_body'
                    })
                };
            }

            // Check if template with this ID already exists
            const existing = await templatesCol.findOne({ id });
            if (existing) {
                return {
                    statusCode: 409,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Template with this ID already exists' })
                };
            }

            const newTemplate = {
                id,
                name,
                subject,
                html_body,
                text_body: text_body || '',
                available_variables: available_variables || [],
                created_at: new Date(),
                updated_at: new Date()
            };

            await templatesCol.insertOne(newTemplate);

            return {
                statusCode: 201,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Template created successfully',
                    template: newTemplate
                })
            };
        }

        // PUT - Update existing template
        if (httpMethod === 'PUT') {
            if (!templateId) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Template ID required in query params' })
                };
            }

            const body = JSON.parse(event.body || '{}');
            const { name, subject, html_body, text_body, available_variables } = body;

            const updates = {
                updated_at: new Date()
            };

            if (name) updates.name = name;
            if (subject) updates.subject = subject;
            if (html_body) updates.html_body = html_body;
            if (text_body !== undefined) updates.text_body = text_body;
            if (available_variables) updates.available_variables = available_variables;

            const result = await templatesCol.updateOne(
                { id: templateId },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return {
                    statusCode: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Template not found' })
                };
            }

            const updated = await templatesCol.findOne({ id: templateId });

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Template updated successfully',
                    template: updated
                })
            };
        }

        // DELETE - Delete template
        if (httpMethod === 'DELETE') {
            if (!templateId) {
                return {
                    statusCode: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Template ID required in query params' })
                };
            }

            const result = await templatesCol.deleteOne({ id: templateId });

            if (result.deletedCount === 0) {
                return {
                    statusCode: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Template not found' })
                };
            }

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Template deleted successfully' })
            };
        }

        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('[Email Templates API] Error:', error);
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
