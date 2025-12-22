# Upwork Signals - Job Market Intelligence Pipeline

A system for monitoring Upwork job postings in automation, web development, and cybersecurity niches. Provides insights into trending skills, budget bands, and repeated job patterns.

## Features

- **OAuth2 Integration**: Secure authentication with Upwork API using Authorization Code flow
- **Daily Job Ingestion**: Automated fetching of job postings with keyword filtering
- **Smart Aggregation**: Daily and weekly statistics with n-gram extraction
- **Repeated Asks Detection**: Identifies common patterns in job postings
- **Web Dashboard**: Visual insights with export capabilities
- **Encrypted Token Storage**: Tokens stored securely in MongoDB with AES-256-GCM encryption

## Setup Instructions

### 1. Register Upwork OAuth Application

1. Go to [Upwork Developer Portal](https://www.upwork.com/developer/keys/apply)
2. Create a new API application
3. Set the **Callback URL** to:
   ```
   https://vschool.io/api/upwork-oauth-callback
   ```
4. Request the following scopes:
   - `entities:read` - Common Entities Read-Only
   - `marketplace:jobs:read` - Read marketplace Job Postings
   - `ontology:read` - Ontology Read-Only

### 2. Configure Environment Variables

Add these variables to your Netlify site settings (Site settings > Environment variables):

| Variable | Description | Example |
|----------|-------------|---------|
| `UPWORK_CLIENT_ID` | OAuth Client ID from Upwork | `abc123...` |
| `UPWORK_CLIENT_SECRET` | OAuth Client Secret from Upwork | `xyz789...` |
| `UPWORK_REDIRECT_URI` | OAuth callback URL | `https://vschool.io/api/upwork-oauth-callback` |
| `UPWORK_TOKEN_ENCRYPTION_KEY` | 64-character hex string for AES-256 encryption | (generate below) |

#### Generate Encryption Key

Run this command to generate a secure encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Authorize the Application

1. Deploy the application to Netlify
2. Log in as an admin user
3. Visit: `https://vschool.io/api/upwork-oauth-init`
4. Authorize the application on Upwork
5. You'll be redirected back with tokens automatically stored

### 4. Verify Setup

1. Check the dashboard at: `https://vschool.io/dashboard-upwork.html`
2. Status should show "Connected"
3. Run a manual sync to verify data fetching works

## API Endpoints

### OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upwork-oauth-init` | GET | Initiates OAuth flow (admin only) |
| `/api/upwork-oauth-callback` | GET | Handles OAuth callback |

### Sync Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upwork-jobs-sync` | GET/POST | Scheduled daily sync (5 AM UTC) |
| `/api/upwork-jobs-sync-manual` | GET/POST | Manual sync trigger (admin only) |

**Manual Sync Parameters:**
- `?niche=automation` - Sync specific niche only
- `?max_jobs=100` - Limit jobs per niche (default: 100, max: 500)
- `?dry_run=true` - Test without storing to database

### Aggregation Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upwork-aggregate-daily` | GET/POST | Daily aggregation (5:30 AM UTC) |
| `/api/upwork-aggregate-weekly` | GET/POST | Weekly aggregation (Sundays 6 AM UTC) |

### Data Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/api-upwork-jobs` | GET | List/search job postings |
| `/api/api-upwork-aggregates` | GET | Get aggregated statistics |
| `/api/api-upwork-export` | GET | Export data (CSV/JSON) |

**Jobs Query Parameters:**
- `?page=1&limit=25` - Pagination
- `?niche=webdev` - Filter by niche
- `?contract_kind=hourly` - Filter by contract type
- `?experience_level=intermediate` - Filter by experience
- `?skill=react` - Filter by skill
- `?search=api` - Text search
- `?from=2025-01-01&to=2025-01-31` - Date range

**Aggregates Query Parameters:**
- `?type=overview` - Dashboard overview (default)
- `?type=daily` - Daily aggregates
- `?type=weekly` - Weekly aggregates
- `?niche=automation` - Filter by niche
- `?days=7` - Number of days (for daily)
- `?weeks=4` - Number of weeks (for weekly)

**Export Query Parameters:**
- `?format=json` or `?format=csv`
- `?type=jobs` - Raw job data
- `?type=skills` - Skill frequency
- `?type=patterns` - Repeated patterns
- `?type=assignments` - Faculty assignment suggestions
- `?niche=cybersecurity` - Filter by niche
- `?days=7` - Date range

## Scheduled Functions

| Function | Schedule | Description |
|----------|----------|-------------|
| `upwork-jobs-sync` | Daily 5:00 AM UTC | Fetches new job postings |
| `upwork-aggregate-daily` | Daily 5:30 AM UTC | Calculates daily statistics |
| `upwork-aggregate-weekly` | Sundays 6:00 AM UTC | Calculates weekly trends |

## Niche Configuration

### Automation
**Include Keywords:**
- n8n, make.com, zapier, airtable, playwright, selenium, supabase
- integromat, automate, workflow, api integration, webhook, scraping

**Exclude Keywords:**
- logo, translation, cv writing, data entry, virtual assistant, typing

### Web Development
**Include Keywords:**
- react, vue, nextjs, nodejs, typescript, tailwind, javascript
- frontend, backend, fullstack, web application, api development

**Exclude Keywords:**
- wordpress theme, shopify theme, logo, graphic design, wix, squarespace

### Cybersecurity
**Include Keywords:**
- penetration testing, pentest, security audit, vulnerability, owasp
- burp suite, nmap, metasploit, soc, siem, incident response
- malware analysis, threat hunting, ethical hacking, bug bounty

**Exclude Keywords:**
- antivirus installation, password reset, tech support, computer repair

## MongoDB Collections

### upwork_tokens
Stores encrypted OAuth tokens.

```javascript
{
  access_token: String (encrypted),
  refresh_token: String (encrypted),
  expires_at: Date,
  scopes: [String],
  is_active: Boolean
}
```

### upwork_jobs_raw
Raw job posting data.

```javascript
{
  upwork_id: String (unique),
  title: String,
  description: String,
  published_at: Date,
  budget_min: Number,
  budget_max: Number,
  contract_kind: "hourly" | "fixed",
  hourly_rate_min: Number,
  hourly_rate_max: Number,
  experience_level: "entry" | "intermediate" | "expert",
  country: String,
  category: String,
  skills: [String],
  keywords_hit: [String],
  niche: String,
  fetched_at: Date
}
```

### upwork_aggregates_daily
Daily statistics per niche.

```javascript
{
  date: Date,
  niche: String,
  total_jobs: Number,
  by_category: { category: count },
  by_skill: { skill: count },
  by_keyword: { keyword: count },
  by_experience: { level: count },
  by_contract_kind: { type: count },
  budget_stats: {
    fixed: { min, max, avg, median },
    hourly: { min, max, avg, median }
  }
}
```

### upwork_aggregates_weekly
Weekly trends and patterns.

```javascript
{
  week_start: Date,
  week_end: Date,
  niche: String,
  total_jobs: Number,
  top_skills: [{ skill, count, change }],
  top_keywords: [{ keyword, count, change }],
  top_ngrams: [{ ngram, count }],
  budget_trends: { fixed_avg, hourly_avg, changes },
  repeated_asks: [{ pattern, count, examples }]
}
```

## Rate Limiting

- Upwork API: 300 requests per minute per IP
- The client automatically throttles requests
- Batch delays between pages: 250ms
- Batch delays between content hydration: 200ms

## Troubleshooting

### Token Issues

**"Token expired" error:**
- Tokens auto-refresh, but if refresh fails, re-authorize at `/api/upwork-oauth-init`

**"No active tokens found":**
- Complete initial OAuth authorization
- Check that `UPWORK_TOKEN_ENCRYPTION_KEY` matches what was used during authorization

### Sync Issues

**"No jobs found":**
- Check if Upwork API access is active
- Verify scopes were granted during authorization
- Try running manual sync with `?dry_run=true` to debug

**Rate limiting:**
- The system automatically handles rate limits
- If issues persist, wait a few minutes before retrying

### Dashboard Issues

**"Authentication required":**
- Log in at `/login.html` first
- Ensure cookies are enabled

## Security Considerations

- All tokens are encrypted with AES-256-GCM before storage
- Encryption key stored in environment variables (never in code)
- OAuth state parameter prevents CSRF attacks
- Admin authentication required for sensitive operations
- No secrets logged to console

## Files Overview

```
netlify/functions/
├── utils/
│   └── upwork-client.js          # API client, encryption, token management
├── upwork-oauth-init.js          # OAuth flow initiation
├── upwork-oauth-callback.js      # OAuth callback handler
├── upwork-jobs-sync.js           # Daily job ingestion (scheduled)
├── upwork-jobs-sync-manual.js    # Manual sync trigger
├── upwork-aggregate-daily.js     # Daily aggregation (scheduled)
├── upwork-aggregate-weekly.js    # Weekly aggregation (scheduled)
├── api-upwork-jobs.js            # Jobs list/search API
├── api-upwork-aggregates.js      # Aggregates API
└── api-upwork-export.js          # CSV/JSON export API

public/
└── dashboard-upwork.html         # Web dashboard
```

## Usage Examples

### Export Skills Report (CSV)
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://vschool.io/api/api-upwork-export?type=skills&format=csv&days=30"
```

### Get Automation Jobs (JSON)
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://vschool.io/api/api-upwork-jobs?niche=automation&limit=50"
```

### Run Manual Sync
```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  "https://vschool.io/api/upwork-jobs-sync-manual?niche=webdev&max_jobs=100"
```

### Get Weekly Overview
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://vschool.io/api/api-upwork-aggregates?type=weekly&weeks=4"
```
