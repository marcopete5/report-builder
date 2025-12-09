# LTP Report Builder - Claude Context Reference

> **Purpose**: This document serves as the authoritative reference for Claude AI when context is compacted, sessions restart, or continuity is needed. It contains the complete application architecture, user preferences, and development best practices.

**Last Updated**: December 9, 2024

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Utility Modules](#utility-modules)
6. [Frontend Pages](#frontend-pages)
7. [Scheduled Jobs](#scheduled-jobs)
8. [Environment Variables](#environment-variables)
9. [User Preferences & Best Practices](#user-preferences--best-practices)
10. [Recent Feature Implementations](#recent-feature-implementations)
11. [Common Tasks](#common-tasks)

---

## Project Overview

**Name**: LTP Report Builder (ltp-netlify)
**Type**: Netlify Functions + Static HTML
**Database**: MongoDB Atlas
**External APIs**: Airtable, Google Ads
**Purpose**: Student progress tracking and reporting system for V School education platform

### Core Functionality
- Track student lesson submissions from the Learning To Program (LTP) platform
- Calculate pace, attendance, and progress metrics
- Generate weekly reports and dashboards
- Manage student data synced from Airtable
- Notification system for automated emails

---

## Architecture

### Project Structure

```
ltp-netlify/
├── netlify.toml                 # Netlify configuration, scheduled functions
├── package.json                 # Dependencies (mongodb, dotenv)
├── public/                      # Static frontend files
│   ├── index.html              # Home/landing page
│   ├── login.html              # Authentication page
│   ├── dashboard-education.html # Education metrics dashboard
│   ├── dashboard-admissions.html # Admissions pipeline dashboard
│   ├── dashboard-ad-spend.html  # Google Ads metrics
│   ├── dashboards.html          # Dashboard selector
│   ├── admin-users.html         # User management
│   ├── notification-admin.html  # Notification rules admin
│   ├── profile.html             # User profile
│   ├── navbar.js                # Shared navigation component
│   ├── ltp.js                   # LTP tracking script
│   └── feedback.js              # Lesson feedback widget
├── netlify/functions/           # Serverless API endpoints
│   ├── utils/                   # Shared utilities
│   │   ├── database.js          # MongoDB connection & indexes
│   │   ├── db-auth.js           # JWT authentication
│   │   ├── cors.js              # CORS headers
│   │   ├── pace-calculator.js   # Student pace calculations
│   │   ├── mock-data.js         # Test student data
│   │   ├── validation.js        # Input validation
│   │   ├── email-service.js     # Email sending (notifications)
│   │   ├── condition-evaluators.js # Notification conditions
│   │   ├── google-ads-client.js # Google Ads API client
│   │   └── logger.js            # Logging utility
│   ├── [function-name].js       # Individual API endpoints
│   └── ...
└── scripts/                     # CLI utilities
    ├── seed-notification-system.js
    ├── sync-student-emails.js
    └── ...
```

### Data Flow

```
[LTP Platform] --POST--> [lesson-entry.js] --INSERT--> [MongoDB: lesson_entries]
                                           --UPSERT--> [MongoDB: students]
                                           --FETCH--> [Airtable API]

[Scheduled: 4 AM UTC] --> [refresh-airtable.js] --> [Update students from Airtable]
[Scheduled: 3:30 AM]  --> [sync-students.js]    --> [Create missing student records]
[Scheduled: 2 AM]     --> [google-ads-sync.js]  --> [Sync ad spend data]
[Scheduled: 3 AM]     --> [sync-admissions-airtable.js] --> [Sync pipeline data]
```

---

## Database Schema

**Database Name**: `Reports` (configurable via `MONGODB_DB`)

### Collections

#### `lesson_entries`
Stores every lesson submission from students.

```javascript
{
  _id: ObjectId,
  createdAt: Date,           // MST timestamp
  studentName: String,
  studentId: String,         // Airtable record ID (e.g., "recXXXXX")
  courseId: String,          // "Web Development", "Cybersecurity", etc.
  lessonId: String,          // e.g., "L1-HTML_BASICS-001"
  lessonTitle: String,
  pageUrl: String,
  utm: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },
  userAgent: String,
  ip: String,
  extra: Object
}
```

**Indexes**:
- `createdAt_desc`: `{ createdAt: -1 }`
- `studentId_createdAt`: `{ studentId: 1, createdAt: -1 }`
- `lessonId_createdAt`: `{ lessonId: 1, createdAt: -1 }`

#### `students`
Cached student data from Airtable with computed fields.

```javascript
{
  _id: ObjectId,
  studentId: String,         // Airtable record ID (unique)
  studentName: String,
  email: String,
  course: String,            // "Web Development", etc.
  institution: String,       // "V School", "TTU", etc.
  courseStartDate: String,   // ISO date
  courseEndDate: String,     // ISO date
  courseExtDate: String,     // Extension date if any
  currentLevel: String,
  profilePicture: String,    // URL
  mentorId: String,          // Airtable mentor record ID
  mentorName: String,
  mentorEmail: String,
  createdAt: Date,
  lastSubmissionAt: Date,
  lastSyncedAt: Date,
  lessonEntries: [ObjectId], // References to lesson_entries
  lessonFeedback: [ObjectId] // References to lesson_feedback
}
```

**Indexes**:
- `studentId_unique`: `{ studentId: 1 }` (unique)
- `course_idx`: `{ course: 1 }`
- `institution_idx`: `{ institution: 1 }`
- `courseEndDate_idx`: `{ courseEndDate: 1 }`

#### `lessons`
Course curriculum structure with story points.

```javascript
{
  _id: ObjectId,
  lessonId: String,          // e.g., "L1-HTML_BASICS-001"
  courseId: String,          // "Web Development"
  title: String,
  level: Number,             // 1, 2, 3, etc.
  section: String,           // Section name
  sectionOrder: Number,
  lessonOrder: Number,
  storyPoints: Number        // Difficulty/effort points
}
```

#### `users`
Authentication users (admins, students).

```javascript
{
  _id: ObjectId,
  email: String,             // Lowercase
  passwordHash: String,      // SHA-256 hash
  role: String,              // "superadmin", "admin", "student"
  studentId: String,         // For student role only
  active: Boolean,
  createdAt: Date,
  lastLogin: Date
}
```

#### `lesson_feedback`
Student feedback on lessons.

```javascript
{
  _id: ObjectId,
  createdAt: Date,
  studentId: String,
  lessonId: String,
  rating: Number,            // 1-5
  feedback: String,
  difficulty: String
}
```

#### `student_pipeline`
Admissions pipeline data synced from Airtable.

```javascript
{
  student_id: String,
  airtable_record_id: String,
  email: String,
  current_admissions_status: String,
  current_foundations_status: String,
  current_new_student_status: String,
  program: String,
  lead_source: String,
  created_at: Date,
  updated_at: Date
}
```

#### `notification_rules`
Automated notification configuration.

```javascript
{
  id: String,
  name: String,
  enabled: Boolean,
  trigger_type: String,      // "pace_behind", "attendance_low", etc.
  condition: {
    type: String,
    threshold: Number
  },
  cooldown_days: Number,
  email_template_id: String,
  created_at: Date
}
```

#### `notification_logs`
Record of sent notifications.

```javascript
{
  rule_id: String,
  student_id: String,
  triggered_at: Date,
  next_eligible_at: Date,
  status: String,            // "sent", "failed", "dry_run"
  dry_run: Boolean,
  email_data: Object
}
```

#### `email_templates`
Email templates for notifications.

```javascript
{
  id: String,
  name: String,
  subject: String,
  body: String,              // Supports {{variables}}
  created_at: Date
}
```

#### `ad_spend`
Google Ads spend data.

```javascript
{
  date: String,              // YYYY-MM-DD
  campaignId: String,
  campaignName: String,
  spend: Number,
  impressions: Number,
  clicks: Number,
  conversions: Number,
  customerId: String,
  syncedAt: Date
}
```

---

## API Endpoints

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth-login` | POST | None | Login with email/password, returns JWT |
| `/api/auth-logout` | POST | Any | Clear auth cookie |
| `/api/auth-me` | GET | Any | Get current user info |
| `/api/auth-signup` | POST | Admin | Create new user |
| `/api/auth-reset-request` | POST | None | Request password reset |
| `/api/auth-reset-verify` | POST | None | Verify reset token |

### Student Data

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/lesson-entry` | POST | None | Record lesson submission |
| `/api/lesson-feedback` | POST | None | Submit lesson feedback |
| `/api/students` | GET | Admin | List all students |
| `/api/student-info` | GET | Admin/Student | Get student details |
| `/api/student-page` | GET | Admin | Full student detail HTML page |

### Dashboards

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/dashboard-education` | GET | Admin | Education metrics JSON |
| `/api/dashboard-admissions` | GET | Admin | Admissions pipeline data |
| `/api/dashboard-ad-spend` | GET | Admin | Google Ads metrics |

### Reports

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/report-weekly` | GET | Admin | Weekly summary report |
| `/api/report-student` | GET | Admin | Individual student report |
| `/api/my-report` | GET | Student | Student's own report |

### Admin Functions

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/users-list` | GET | Admin | List all users |
| `/api/users-create` | POST | Admin | Create user |
| `/api/users-delete` | DELETE | Superadmin | Delete user |
| `/api/refresh-airtable` | POST | Superadmin/Scheduled | Refresh all student data |
| `/api/sync-students` | POST | Scheduled | Sync missing students |
| `/api/db-inspect` | GET | Admin | Database inspection tool |

### Lessons

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/lessons` | GET | Admin | List all lessons |
| `/api/lessons-seed` | POST | Superadmin | Seed lesson data |

### Notifications

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/api-notification-rules` | GET/POST/PUT/DELETE | Admin | Manage notification rules |
| `/api/api-email-templates` | GET/POST/PUT/DELETE | Admin | Manage email templates |
| `/api/api-notification-logs` | GET | Admin | View notification history |
| `/api/notification-engine` | POST | Scheduled | Process notifications |

---

## Utility Modules

### `database.js`
```javascript
const { getDb } = require('./utils/database');
const db = await getDb();  // Returns MongoDB Db instance
const db = await getDb('OtherDatabase');  // Specify database name

// Index creation functions (idempotent)
await createLessonEntryIndexes(db);
await createStudentIndexes(db);
await createLessonFeedbackIndexes(db);
await createStudentPipelineIndexes(db);
await createNotificationRulesIndexes(db);
await createNotificationLogsIndexes(db);
await createEmailTemplatesIndexes(db);
```

### `db-auth.js`
```javascript
const {
  hashPassword,           // Hash password for storage
  verifyCredentials,      // Check email/password
  createToken,            // Create JWT
  verifyToken,            // Validate JWT
  getUserFromEvent,       // Extract user from request
  requireAuth,            // Middleware: require any auth
  requireAdmin,           // Middleware: require admin role
  requireStudent,         // Middleware: require student role
  isSuperAdmin,           // Check if superadmin
  isAdmin,                // Check if admin or superadmin
  isStudent,              // Check if student
  getAuthorizedStudentId  // Get studentId user can access
} = require('./utils/db-auth');

// Usage in function:
const authError = requireAdmin(event, corsHeaders);
if (authError) return authError;  // Returns 401/403 response
```

### `pace-calculator.js`
```javascript
const { calculatePace } = require('./utils/pace-calculator');

const pace = calculatePace({
  courseLessons,           // All lessons in course
  submittedLessonIds,      // Array of lessonIds submitted
  courseStartDate,         // ISO date string
  courseEndDate            // ISO date string
});

// Returns:
{
  requiredDailyPace: 2.5,  // Points needed per day from now
  actualDailyPace: 2.3,    // Points achieved per day so far
  paceStatus: 'behind',    // 'ahead', 'on-pace', 'behind', 'dnf'
  daysRemaining: 45,
  isPastEndDate: false,
  completedStoryPoints: 250,
  expectedStoryPoints: 280,
  totalStoryPoints: 497,
  remainingStoryPoints: 247
}
```

### `cors.js`
```javascript
const { getCorsHeaders } = require('./utils/cors');
const headers = getCorsHeaders('GET,POST,OPTIONS');
```

---

## Frontend Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` or `/index.html` | Landing page with navigation |
| Login | `/login.html` | Authentication form |
| Dashboards | `/dashboards.html` | Dashboard selector |
| Education Dashboard | `/dashboard-education.html` | Student metrics, pace, attendance |
| Admissions Dashboard | `/dashboard-admissions.html` | Pipeline funnel |
| Ad Spend Dashboard | `/dashboard-ad-spend.html` | Google Ads metrics |
| Admin Users | `/admin-users.html` | User management |
| Notification Admin | `/notification-admin.html` | Notification rules |
| Student Detail | `/.netlify/functions/student-page?studentId=X` | Full student page (server-rendered) |
| Weekly Report | `/.netlify/functions/report-weekly?view=html` | Weekly summary |
| Profile | `/profile.html` | User profile |

---

## Scheduled Jobs

Configured in `netlify.toml`:

| Function | Schedule | Description |
|----------|----------|-------------|
| `google-ads-sync` | 0 2 * * * (2 AM UTC) | Sync Google Ads data |
| `sync-admissions-airtable` | 0 3 * * * (3 AM UTC) | Sync admissions pipeline |
| `sync-students` | 30 3 * * * (3:30 AM UTC) | Create missing student records |
| `refresh-airtable` | 0 4 * * * (4 AM UTC) | Refresh all student data from Airtable |

---

## Environment Variables

### Required

```
MONGODB_URI=mongodb+srv://...
MONGODB_DB=Reports
JWT_SECRET=your-secret-key
```

### Airtable Integration

```
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...
AIRTABLE_TABLE=Students
```

### Google Ads (Optional)

```
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_REFRESH_TOKEN=...
GOOGLE_ADS_CUSTOMER_IDS=123,456
```

### Email (Optional)

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=noreply@example.com
```

### Other

```
CORS_ORIGIN=*
ZAPIER_HOOK_URL=https://hooks.zapier.com/...
```

---

## User Preferences & Best Practices

### CRITICAL: Development Workflow

1. **ALWAYS restart the dev server after making code changes**
   ```bash
   pkill -f "netlify dev"; sleep 1; netlify dev &
   ```
   Or use this pattern in Claude:
   ```
   After editing files, run: pkill -f "netlify dev" 2>/dev/null; sleep 1; netlify dev &
   ```

2. **ALWAYS update this document (`CLAUDE_CONTEXT.md`) when new preferences are established**

### Code Style Preferences

- Use CommonJS (`require`/`module.exports`) - NOT ES modules
- Server-side HTML rendering for complex pages (like `student-page.js`)
- Embedded JavaScript in HTML for interactive features
- Chart.js for data visualization

### UI/UX Preferences (Student Detail Page)

1. **Time Display Formatting**:
   - Under 24 hours: `Xh Ym` (e.g., "5h 30m")
   - 24+ hours: `Xd Yh Zm` (e.g., "2d 5h 30m")
   - 7+ days: `Xw Yd Zh` (e.g., "1w 3d 5h")

2. **Working Days Calculation**: 8 hours = 1 working day

3. **Submission Table Features**:
   - Color coding: White for first-time submissions, Yellow (#fef3c7) for review
   - "Review" = returning to a lesson AFTER working on a different lesson
   - Break Time rows: Blue (#dbeafe) background, appears BEFORE the submission
   - Break time cap: 2 hours max per session, excess shows as Break Time
   - Sortable columns: Date, Time Spent, Total Time (click headers)
   - Filter buttons: All, First Time, Review
   - Total Time column switches to Review Time when Review filter is active

4. **Default Period**: "Full Period" (from course start to now)

5. **Statistics Display**:
   - Total Time Spent
   - First-Time Only
   - Total Review Time
   - Working Days (8hr = 1 day)

### Error Handling

- Always return proper error responses with status codes
- Log errors server-side but return sanitized messages to client
- Handle Airtable API failures gracefully (continue with cached data)

---

## Recent Feature Implementations

### Student Detail Page (`student-page.js`)

**Recent Changes** (December 2024):

1. **Time Statistics Section**:
   - Total Time Spent (with days/weeks formatting)
   - First-Time Only time
   - Total Review Time
   - Working Days (8hr = 1 day calculation)

2. **Submissions Table Enhancements**:
   - First/Review detection with color coding
   - Filter buttons (All, First Time, Review)
   - Break Time rows (blue, 2hr cap)
   - Sortable columns (Date, Time Spent, Total Time)
   - Dynamic Total Time/Review Time column based on filter
   - Clickable lesson titles showing stats modal

3. **First/Review Logic**:
   ```javascript
   // A submission is "review" only if:
   // 1. The lesson has been seen before, AND
   // 2. A DIFFERENT lesson was worked on since the first submission
   // Same lesson submissions in a row = still "first"
   ```

4. **Break Time Calculation**:
   ```javascript
   // Time between submissions capped at 2 hours
   // Excess time shown as Break Time row
   // Break row appears BEFORE the submission that triggered it
   ```

### Key File Locations for Features

| Feature | File | Line Reference |
|---------|------|----------------|
| First/Review logic | `student-page.js` | ~1360-1380 |
| Break time calculation | `student-page.js` | ~1496-1522 |
| Time formatting | `student-page.js` | ~652-667 |
| Sorting function | `student-page.js` | ~1875-1940 |
| Filter function | `student-page.js` | ~1818-1869 |
| Pace calculation | `utils/pace-calculator.js` | Full file |

---

## Common Tasks

### Adding a New API Endpoint

1. Create file in `netlify/functions/`
2. Export handler function:
   ```javascript
   const { getCorsHeaders } = require('./utils/cors');

   exports.handler = async (event) => {
     const corsHeaders = getCorsHeaders('GET,OPTIONS');

     if (event.httpMethod === 'OPTIONS') {
       return { statusCode: 204, headers: corsHeaders, body: '' };
     }

     // Your logic here

     return {
       statusCode: 200,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
       body: JSON.stringify({ data: 'response' })
     };
   };
   ```

3. **RESTART DEV SERVER**

### Adding Authentication to an Endpoint

```javascript
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
  const corsHeaders = getCorsHeaders('GET,OPTIONS');

  // Add this after OPTIONS check
  const authError = requireAdmin(event, corsHeaders);
  if (authError) return authError;

  // Your protected logic here
};
```

### Working with the Database

```javascript
const { getDb, createStudentIndexes } = require('./utils/database');

const db = await getDb();
await createStudentIndexes(db);  // Ensure indexes exist

const coll = db.collection('students');
const student = await coll.findOne({ studentId: 'recXXX' });
```

### Testing Locally

```bash
# Start dev server
netlify dev

# Server runs on http://localhost:8888
# Functions available at http://localhost:8888/.netlify/functions/[name]
```

---

## Troubleshooting

### Common Issues

1. **500 Error: Missing MONGODB_URI**
   - Restart dev server: `pkill -f "netlify dev"; netlify dev`
   - Check `.env` file exists with `MONGODB_URI`

2. **Authentication failures**
   - Verify JWT_SECRET is set
   - Check token expiration (7 days)
   - Clear cookies and re-login

3. **Airtable sync failures**
   - Verify AIRTABLE_API_KEY and AIRTABLE_BASE_ID
   - Check student record exists in Airtable
   - Student continues to work with cached data

4. **Pace calculation returns null**
   - Ensure student has courseStartDate and courseEndDate
   - Verify lessons exist for the student's course
   - Check student has at least one submission

---

## Notes for Future Sessions

When Claude context is compacted or session restarts:

1. **Read this file first** to understand the project
2. **Check git status** to see uncommitted changes
3. **Review recent files** modified in the session
4. **Remember**: Always restart dev server after changes!

### Session Continuity Checklist

- [ ] Read CLAUDE_CONTEXT.md
- [ ] Check `git status` for current state
- [ ] Identify any running background processes
- [ ] Understand user's current task/request
- [ ] Follow established preferences (dev server restart, etc.)

---

*This document should be updated whenever new features are added, preferences change, or important architectural decisions are made.*
