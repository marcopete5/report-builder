// /.netlify/functions/notification-engine
// Core notification engine - runs on schedule to evaluate rules and send notifications
// Supports dry-run mode for testing

const {
    getDb,
    createNotificationRulesIndexes,
    createNotificationLogsIndexes,
    createEmailTemplatesIndexes,
    createStudentIndexes
} = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { evaluateCondition } = require('./utils/condition-evaluators');
const { sendEmail, renderTemplate, getRecipients } = require('./utils/email-service');

/**
 * Main notification engine handler
 * Can be triggered by schedule or manually (with dry-run option)
 */
exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Parse query parameters
    const params = event.queryStringParameters || {};
    const dryRun = params.dry_run === 'true' || params.dryRun === 'true';
    const ruleId = params.rule_id || null; // Optional: test specific rule only
    const studentId = params.student_id || null; // Optional: test specific student only
    const force = params.force === 'true'; // Optional: bypass cooldown for testing

    const isScheduled = event.headers['x-nf-event'] === 'schedule';

    console.log('[Notification Engine] Starting...', {
        dryRun,
        isScheduled,
        ruleId,
        studentId,
        force
    });

    try {
        const db = await getDb();

        // Create indexes
        await Promise.all([
            createNotificationRulesIndexes(db),
            createNotificationLogsIndexes(db),
            createEmailTemplatesIndexes(db),
            createStudentIndexes(db)
        ]);

        // Get collections
        const rulesCol = db.collection('notification_rules');
        const logsCol = db.collection('notification_logs');
        const templatesCol = db.collection('email_templates');
        const studentsCol = db.collection('students');

        // Fetch active rules
        const rulesQuery = { enabled: true };
        if (ruleId) {
            rulesQuery.id = ruleId;
        }

        const activeRules = await rulesCol.find(rulesQuery).toArray();
        console.log(`[Notification Engine] Found ${activeRules.length} active rules`);

        if (activeRules.length === 0) {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'No active rules to process',
                    dry_run: dryRun,
                    rules_checked: 0
                })
            };
        }

        // Process each rule
        const results = {
            dry_run: dryRun,
            timestamp: new Date().toISOString(),
            rules_processed: 0,
            students_checked: 0,
            notifications_triggered: 0,
            notifications_sent: 0,
            notifications_skipped: 0,
            notifications_failed_no_email: 0,
            errors: [],
            details: []
        };

        for (const rule of activeRules) {
            try {
                console.log(`[Notification Engine] Processing rule: ${rule.id}`);

                // Build student query based on rule filters
                const studentQuery = {};
                if (studentId) {
                    studentQuery.studentId = studentId;
                }

                // Apply filters from rule
                if (rule.filters) {
                    if (rule.filters.student_status) {
                        // Filter by current/former based on course end date
                        const today = new Date();
                        if (rule.filters.student_status.includes('current')) {
                            studentQuery.$or = [
                                { courseEndDate: { $gte: today } },
                                { courseExtDate: { $gte: today } }
                            ];
                        } else if (rule.filters.student_status.includes('former')) {
                            studentQuery.courseEndDate = { $lt: today };
                            studentQuery.$or = [
                                { courseExtDate: { $exists: false } },
                                { courseExtDate: { $lt: today } }
                            ];
                        }
                    }

                    if (rule.filters.courses && rule.filters.courses.length > 0) {
                        studentQuery.course = { $in: rule.filters.courses };
                    }

                    if (rule.filters.institutions && rule.filters.institutions.length > 0) {
                        studentQuery.institution = { $in: rule.filters.institutions };
                    }

                    if (rule.filters.exclude_students && rule.filters.exclude_students.length > 0) {
                        studentQuery.studentId = { $nin: rule.filters.exclude_students };
                    }
                }

                // Fetch students to check
                const students = await studentsCol.find(studentQuery).toArray();
                console.log(`[Notification Engine] Checking ${students.length} students for rule ${rule.id}`);

                results.students_checked += students.length;

                // Evaluate condition for each student
                for (const student of students) {
                    try {
                        // Check cooldown - has this notification been sent recently?
                        // Skip cooldown check if force parameter is set (for testing)
                        if (!force && rule.cooldown && rule.cooldown.enabled) {
                            const recentLog = await logsCol.findOne({
                                rule_id: rule.id,
                                student_id: student.studentId,
                                next_eligible_at: { $gt: new Date() }
                            });

                            if (recentLog) {
                                console.log(`[Notification Engine] Skipping ${student.studentId} - in cooldown until ${recentLog.next_eligible_at}`);
                                results.notifications_skipped++;
                                continue;
                            }
                        }

                        if (force) {
                            console.log(`[Notification Engine] Force mode enabled - bypassing cooldown and condition checks for ${student.studentId}`);
                        }

                        // Evaluate condition (or skip if force mode)
                        let conditionResult;
                        if (force) {
                            // Force mode: skip condition check, create dummy result for template data
                            const lastActivityDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                            conditionResult = {
                                triggered: true,
                                data: {
                                    // Provide sample data for testing
                                    daysInactive: 7,
                                    lastActivityDate: lastActivityDate.toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    }),
                                    lastLesson: 'React Hooks Tutorial',
                                    currentLevel: student.currentLevel || 'N/A',
                                    expectedLevel: student.expectedLevel || 'N/A',
                                    daysUntilDeadline: 30
                                }
                            };
                        } else {
                            conditionResult = await evaluateCondition(
                                rule.condition.type,
                                rule.condition.params,
                                student,
                                db
                            );
                        }

                        if (conditionResult.triggered) {
                            results.notifications_triggered++;
                            console.log(`[Notification Engine] Condition triggered for ${student.studentId}:`, conditionResult.data);

                            // Execute actions
                            const actionsResults = [];

                            for (const action of rule.actions) {
                                if (action.type === 'email') {
                                    try {
                                        // Get email template
                                        const template = await templatesCol.findOne({ id: action.template_id });

                                        if (!template) {
                                            console.warn(`[Notification Engine] Template not found: ${action.template_id}`);
                                            continue;
                                        }

                                        // Prepare template data
                                        const templateData = {
                                            studentName: student.studentName || 'Student',
                                            mentorName: student.mentorName || 'your mentor',
                                            ...conditionResult.data,
                                            ...student
                                        };

                                        // Render email
                                        const htmlBody = renderTemplate(template.html_body, templateData);
                                        const subject = renderTemplate(action.subject || template.subject, templateData);

                                        // Get recipients
                                        const recipients = await getRecipients(student, action.recipients);

                                        if (!recipients.to) {
                                            console.warn(`[Notification Engine] No valid recipient for ${student.studentId} - student has no email address`);
                                            results.notifications_failed_no_email++;
                                            results.details.push({
                                                student_id: student.studentId,
                                                student_name: student.studentName,
                                                issue: 'No email address',
                                                rule_id: rule.id
                                            });
                                            continue;
                                        }

                                        // Send email (or skip if dry run)
                                        let emailResult = null;
                                        if (!dryRun) {
                                            emailResult = await sendEmail({
                                                to: recipients.to,
                                                bcc: recipients.bcc,
                                                subject,
                                                html: htmlBody
                                            });
                                            results.notifications_sent++;
                                        }

                                        actionsResults.push({
                                            type: 'email',
                                            status: dryRun ? 'skipped_dry_run' : 'sent',
                                            to: recipients.to,
                                            bcc: recipients.bcc,
                                            sent_at: emailResult?.sent_at || null,
                                            message_id: emailResult?.message_id || null
                                        });

                                        console.log(`[Notification Engine] Email ${dryRun ? 'would be sent' : 'sent'} to ${recipients.to}`);
                                    } catch (emailError) {
                                        console.error(`[Notification Engine] Error sending email:`, emailError);
                                        actionsResults.push({
                                            type: 'email',
                                            status: 'failed',
                                            error: emailError.message
                                        });
                                    }
                                }
                            }

                            // Log the notification
                            const nextEligibleAt = rule.cooldown && rule.cooldown.enabled
                                ? new Date(Date.now() + rule.cooldown.days * 24 * 60 * 60 * 1000)
                                : null;

                            await logsCol.insertOne({
                                rule_id: rule.id,
                                rule_name: rule.name,
                                student_id: student.studentId,
                                student_name: student.studentName,
                                triggered_at: new Date(),
                                dry_run: dryRun,
                                status: actionsResults.some(a => a.status === 'failed') ? 'failed' : 'sent',
                                actions_taken: actionsResults,
                                condition_data: conditionResult.data,
                                next_eligible_at: nextEligibleAt
                            });
                        }
                    } catch (studentError) {
                        console.error(`[Notification Engine] Error processing student ${student.studentId}:`, studentError);
                        results.errors.push({
                            student_id: student.studentId,
                            rule_id: rule.id,
                            error: studentError.message
                        });
                    }
                }

                // Update rule stats
                await rulesCol.updateOne(
                    { _id: rule._id },
                    {
                        $set: { last_run_at: new Date() },
                        $inc: { 'stats.total_triggered': results.notifications_triggered }
                    }
                );

                results.rules_processed++;
            } catch (ruleError) {
                console.error(`[Notification Engine] Error processing rule ${rule.id}:`, ruleError);
                results.errors.push({
                    rule_id: rule.id,
                    error: ruleError.message
                });
            }
        }

        console.log('[Notification Engine] Completed', results);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Notification engine completed',
                ...results
            })
        };
    } catch (error) {
        console.error('[Notification Engine] Fatal error:', error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Notification engine failed',
                details: error.message
            })
        };
    }
};
