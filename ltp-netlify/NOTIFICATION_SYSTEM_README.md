# Notification System - Milestone 1 Complete! 🎉

## What We Built

A fully functional automated notification system that can trigger emails based on student behavior patterns. This system is designed to scale to dozens of different notification rules with ease.

---

## System Overview

### Architecture

```
┌─────────────────────────────────────────┐
│  Scheduled Function (daily at 6 AM)    │
│  notification-engine.js                 │
└─────────────────────────────────────────┘
           │
           ├─> Fetch active rules from MongoDB
           ├─> Fetch students matching filters
           ├─> For each student:
           │     └─> Evaluate condition
           │           └─> Check cooldown
           │                 └─> Send email if triggered
           └─> Log results

Email Provider: Resend (3,000 emails/month free)
```

### MongoDB Collections

1. **`notification_rules`** - Stores rule definitions
2. **`notification_logs`** - Tracks notifications sent (prevents duplicates)
3. **`email_templates`** - Stores email templates with variables

---

## What's Working Right Now

### ✅ Core Notification Engine
- Runs on schedule OR manually
- **Dry-run mode** for testing without sending emails
- Evaluates rules against students
- Sends emails via Resend API
- Logs all actions for audit trail
- Cooldown system prevents spam

### ✅ Condition Types Implemented
1. **`no_activity`** - Triggers when student hasn't submitted in X days
2. **`behind_pace`** - Triggers when student is behind expected progress
3. **`milestone_reached`** - Triggers when student reaches specific lessons
4. **`approaching_deadline`** - Triggers X days before course ends
5. **`low_activity`** - Triggers when submissions < threshold in X days

### ✅ Test Rule Created
- **7 Day Inactivity Warning**
  - Checks all current students
  - Triggers if no lesson submission in 7+ days
  - Sends email to student with BCC to mentor
  - 14-day cooldown (won't send again for 2 weeks)
  - Currently **working**: Found 3 students who would receive it!

---

## How to Use

### Testing in Dry-Run Mode

```bash
# Test all rules (no emails sent)
curl "http://localhost:8888/.netlify/functions/notification-engine?dry_run=true"

# Test specific student
curl "http://localhost:8888/.netlify/functions/notification-engine?dry_run=true&student_id=recXXXXXXX"

# Test specific rule only
curl "http://localhost:8888/.netlify/functions/notification-engine?dry_run=true&rule_id=inactive-7-days"
```

### Running Live (Actually Send Emails)

```bash
# Send emails for real
curl "http://localhost:8888/.netlify/functions/notification-engine"
```

### Checking Test Data

```bash
# See which students would trigger rules
node scripts/test-notification-engine.js
```

---

## Current Test Results

**Last Test Run:**
- ✅ Checked: 5 students
- ✅ Triggered: 3 students (Marcus, Kevin, Jay)
- ✅ Emails would be sent to:
  - Marcus (50 days inactive)
  - Kevin (20 days inactive)
  - Jay (8 days inactive)

**Note:** Currently students don't have email addresses in the database, so emails won't actually send. You'll need to add email addresses via the Airtable sync.

---

## Files Created

### Core Engine
- `netlify/functions/notification-engine.js` - Main scheduled function
- `netlify/functions/utils/email-service.js` - Resend email integration
- `netlify/functions/utils/condition-evaluators.js` - Rule condition logic
- `netlify/functions/utils/database.js` - Updated with notification indexes

### Scripts
- `scripts/seed-notification-system.js` - Creates initial template & rule
- `scripts/test-notification-engine.js` - Test which students would trigger
- `scripts/update-test-rule.js` - Modify rules for testing

### Environment
- Added `RESEND_API_KEY` to `.env.local` and Netlify environment

---

## Next Steps (Phase 2 & 3)

### Phase 2: Rule Management APIs
- [ ] GET `/api/notification-rules` - List all rules
- [ ] POST `/api/notification-rules` - Create new rule
- [ ] PUT `/api/notification-rules/:id` - Update rule
- [ ] DELETE `/api/notification-rules/:id` - Delete rule
- [ ] GET `/api/notification-logs` - View notification history

### Phase 3: Admin UI
- [ ] Build dashboard to create/edit rules visually
- [ ] Template editor
- [ ] Dry-run testing interface
- [ ] View logs and statistics
- [ ] Enable/disable rules with toggle

### Phase 4: Real-Time Triggers
- [ ] Event-driven triggers (on lesson submission, status change, etc.)
- [ ] Webhook support for external integrations

---

## Adding New Notification Rules

### Option 1: Via MongoDB (Current)

Use the seed script as a template and modify:
1. Email template (HTML, subject, variables)
2. Rule configuration (condition, filters, actions)
3. Run the seed script

### Option 2: Via UI (Coming in Phase 3)

Will allow creating rules through a visual interface.

---

## Example: Creating a "Behind Pace" Notification

```javascript
// Add to seed script or insert directly into MongoDB

const behindPaceTemplate = {
    id: 'behind-pace-warning',
    name: 'Behind Pace Warning',
    subject: 'Let\'s get you back on track, {{studentName}}!',
    html_body: `
        <p>Hi {{studentName}},</p>
        <p>You're currently at level {{currentLevel}}, but based on your
        course timeline, you should be at level {{expectedLevel}}.</p>
        <p>You're {{behindBy}} levels behind pace with {{daysRemaining}}
        days left in your course.</p>
        <p>Your mentor {{mentorName}} can help you create a plan to catch up!</p>
    `,
    available_variables: ['studentName', 'mentorName', 'currentLevel',
                          'expectedLevel', 'behindBy', 'daysRemaining']
};

const behindPaceRule = {
    id: 'behind-pace-5-levels',
    name: 'Behind Pace by 5+ Levels',
    enabled: true,
    trigger_type: 'scheduled',
    filters: {
        student_status: ['current']
    },
    condition: {
        type: 'behind_pace',
        params: { threshold: 5 }
    },
    actions: [{
        type: 'email',
        template_id: 'behind-pace-warning',
        recipients: {
            to: ['student'],
            bcc: ['mentor']
        }
    }],
    cooldown: { enabled: true, days: 7 }
};
```

---

## Troubleshooting

### "No students checked"
- Check the rule's `filters` settings
- Make sure students have valid `courseEndDate` if filtering by status

### "Notifications triggered but not sent"
- Check if students have email addresses in database
- Verify Resend API key is set correctly
- Check notification logs for errors

### "Condition not triggering"
- Test with dry-run mode and check logs
- Run `node scripts/test-notification-engine.js` to see student data
- Verify condition parameters (e.g., days threshold)

---

## Monitoring

### View Notification Logs (MongoDB)

```javascript
// In MongoDB or via script
db.notification_logs.find({
    triggered_at: { $gte: new Date('2025-01-26') }
}).sort({ triggered_at: -1 })
```

### Check Rule Statistics

```javascript
db.notification_rules.find({}, {
    id: 1,
    name: 1,
    enabled: 1,
    last_run_at: 1,
    stats: 1
})
```

---

## Scheduling for Production

To schedule the notification engine to run daily at 6 AM UTC, add to `netlify.toml`:

```toml
[functions."notification-engine"]
  schedule = "0 6 * * *"  # 6 AM UTC daily
```

**Note:** Remove the `dry_run` parameter for production!

---

## Success Metrics

✅ **Milestone 1 Complete:**
- Notification engine fully functional
- Dry-run mode working
- Test rule successfully identifies 3 students
- Email service integrated (Resend)
- 5 condition types implemented
- Database structure created
- Cooldown system working

🎯 **Ready for:**
- Building more notification rules
- Adding student email addresses
- Deploying to production
- Building admin UI (Phase 3)

---

## Questions or Issues?

Check the Netlify function logs for detailed execution info:
```bash
netlify dev
# Then watch the console output when testing
```
