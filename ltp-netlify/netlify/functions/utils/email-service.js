// Email service utility using Resend
// Handles sending transactional emails with template rendering

/**
 * Send an email using Resend API
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string|string[]} options.bcc - BCC email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} options.text - Plain text body (optional)
 * @param {string} options.from - From email (defaults to tools@vschool.io)
 * @returns {Promise<Object>} Response with message_id and status
 */
async function sendEmail({ to, bcc, subject, html, text, from = 'V School <tools@vschool.io>' }) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY environment variable is not set');
    }

    const emailData = {
        from,
        to,
        subject,
        html,
    };

    // Add text version if provided
    if (text) {
        emailData.text = text;
    }

    // Add BCC if provided
    if (bcc) {
        emailData.bcc = Array.isArray(bcc) ? bcc : [bcc];
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(emailData),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Resend API error: ${response.status} - ${JSON.stringify(errorData)}`);
        }

        const result = await response.json();

        return {
            success: true,
            message_id: result.id,
            to,
            bcc: emailData.bcc || [],
            sent_at: new Date()
        };
    } catch (error) {
        console.error('[Email Service] Error sending email:', error);
        throw error;
    }
}

/**
 * Render an email template with variables
 * @param {string} template - HTML template with {{variable}} placeholders
 * @param {Object} data - Data to inject into template
 * @returns {string} Rendered HTML
 */
function renderTemplate(template, data) {
    let rendered = template;

    // Replace all {{variable}} with data values
    for (const [key, value] of Object.entries(data)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        rendered = rendered.replace(regex, value || '');
    }

    return rendered;
}

/**
 * Get email addresses for recipients based on rule configuration
 * @param {Object} student - Student record
 * @param {Object} recipients - Recipients configuration from rule
 * @returns {Object} { to: string, bcc: string[] }
 */
async function getRecipients(student, recipients) {
    const to = [];
    const bcc = [];

    // Process 'to' recipients
    if (recipients.to) {
        for (const recipientType of recipients.to) {
            if (recipientType === 'student') {
                if (student.email) {
                    to.push(student.email);
                }
            } else if (recipientType === 'mentor') {
                if (student.mentorEmail) {
                    bcc.push(student.mentorEmail);
                }
            } else if (recipientType === 'admin') {
                // Add admin emails - can be configured in env or hardcoded
                const adminEmail = process.env.ADMIN_EMAIL || 'admin@vschool.io';
                bcc.push(adminEmail);
            } else if (recipientType.includes('@')) {
                // Direct email address
                to.push(recipientType);
            }
        }
    }

    // Process 'bcc' recipients
    if (recipients.bcc) {
        for (const recipientType of recipients.bcc) {
            if (recipientType === 'mentor') {
                if (student.mentorEmail) {
                    bcc.push(student.mentorEmail);
                }
            } else if (recipientType === 'admin') {
                const adminEmail = process.env.ADMIN_EMAIL || 'admin@vschool.io';
                bcc.push(adminEmail);
            } else if (recipientType.includes('@')) {
                // Direct email address
                bcc.push(recipientType);
            }
        }
    }

    return {
        to: to[0] || null, // Resend expects single 'to' address
        bcc: [...new Set(bcc)] // Remove duplicates
    };
}

module.exports = {
    sendEmail,
    renderTemplate,
    getRecipients
};
