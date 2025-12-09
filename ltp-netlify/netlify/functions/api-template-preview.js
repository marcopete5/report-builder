// /.netlify/functions/api-template-preview
// Preview template with actual student data

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { renderTemplate } = require('./utils/email-service');
const { evaluateCondition } = require('./utils/condition-evaluators');

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
        const params = event.queryStringParameters || {};
        const templateId = params.template_id;
        const studentId = params.student_id;
        const ruleId = params.rule_id;

        if (!templateId || !studentId) {
            return {
                statusCode: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'template_id and student_id are required' })
            };
        }

        const db = await getDb();
        const templatesCol = db.collection('email_templates');
        const studentsCol = db.collection('students');
        const rulesCol = db.collection('notification_rules');

        // Get template
        const template = await templatesCol.findOne({ id: templateId });
        if (!template) {
            return {
                statusCode: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Template not found' })
            };
        }

        // Get student
        const student = await studentsCol.findOne({ studentId });
        if (!student) {
            return {
                statusCode: 404,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Student not found' })
            };
        }

        // Get condition data if rule is provided
        let conditionData = {};
        if (ruleId) {
            const rule = await rulesCol.findOne({ id: ruleId });
            if (rule) {
                const conditionResult = await evaluateCondition(
                    rule.condition.type,
                    rule.condition.params,
                    student,
                    db
                );
                conditionData = conditionResult.data || {};
            }
        }

        // Build template data
        const templateData = {
            studentName: student.studentName || 'Student',
            studentId: student.studentId,
            email: student.email || 'student@example.com',
            course: student.course || 'N/A',
            institution: student.institution || 'N/A',
            mentorName: student.mentorName || 'your mentor',
            mentorEmail: student.mentorEmail || 'mentor@vschool.io',
            currentLevel: student.currentLevel || 'N/A',
            expectedLevel: student.expectedLevel || 'N/A',
            ...conditionData,
            ...student
        };

        // Render the template
        const renderedHtml = renderTemplate(template.html_body, templateData);
        const renderedSubject = renderTemplate(template.subject, templateData);
        const renderedText = template.text_body ? renderTemplate(template.text_body, templateData) : null;

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template: {
                    id: template.id,
                    name: template.name,
                    subject: renderedSubject,
                    html_body: renderedHtml,
                    text_body: renderedText,
                    available_variables: template.available_variables
                },
                variables: templateData,
                student: {
                    id: student.studentId,
                    name: student.studentName,
                    email: student.email
                }
            })
        };

    } catch (error) {
        console.error('[Template Preview API] Error:', error);
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
