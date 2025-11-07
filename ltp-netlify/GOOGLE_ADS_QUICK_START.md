# Google Ads Integration - Quick Start Guide

This is a streamlined guide to get your Google Ads data flowing into the dashboard as quickly as possible.

## Prerequisites

- Google Ads account with active campaigns
- Admin access to the Google Ads account
- Netlify site deployed
- MongoDB database configured

## 5-Minute Setup

### Step 1: Get Google Ads Credentials (5 minutes)

1. **Create Google Cloud Project:**
   - Go to https://console.cloud.google.com/
   - Create new project: "V-School-Ads"

2. **Enable Google Ads API:**
   - In project, go to "APIs & Services > Library"
   - Search "Google Ads API" and enable it

3. **Create OAuth Credentials:**
   - Go to "APIs & Services > Credentials"
   - Click "Create Credentials > OAuth client ID"
   - Type: Web application
   - Authorized redirect URIs: `https://your-site.netlify.app/.netlify/functions/google-ads-oauth-callback`
   - Save the Client ID and Client Secret

4. **Get Developer Token:**
   - Go to https://ads.google.com/aw/apicenter
   - Apply for API access (takes 24-48 hours for approval)
   - Copy your Developer Token once approved

5. **Get Customer ID:**
   - Log into Google Ads at https://ads.google.com
   - Top right corner shows ID like `123-456-7890`
   - Remove dashes: `1234567890`

### Step 2: Configure Netlify Environment Variables

In Netlify (Site settings > Environment variables), add:

```
GOOGLE_ADS_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_ADS_CLIENT_SECRET=your-client-secret
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
GOOGLE_ADS_CUSTOMER_ID=1234567890
```

Deploy your site after adding these.

### Step 3: Complete OAuth Flow (1 minute)

1. Visit: `https://your-site.netlify.app/.netlify/functions/google-ads-oauth-init`
2. Sign in with Google account that has access to Google Ads
3. Authorize the app
4. Copy the refresh token displayed
5. Add to Netlify environment variables:
   ```
   GOOGLE_ADS_REFRESH_TOKEN=your-refresh-token
   ```
6. Deploy again

### Step 4: Test & Sync (1 minute)

1. **Test connection:**
   Visit: `https://your-site.netlify.app/.netlify/functions/google-ads-sync-test`

   You should see your Google Ads data!

2. **Sync to database:**
   Visit: `https://your-site.netlify.app/.netlify/functions/google-ads-sync`

   This pulls the last 7 days of data into MongoDB.

3. **View dashboard:**
   Visit: `https://your-site.netlify.app/dashboard-ad-spend.html`

   Your dashboard now shows real data!

## Automatic Daily Sync

The system is already configured to sync automatically at 2 AM UTC every day (see `netlify.toml`).

## Manual Sync

To manually sync data for a specific date range:

```
https://your-site.netlify.app/.netlify/functions/google-ads-sync?startDate=2025-01-01&endDate=2025-01-31
```

## Troubleshooting

### "Developer token is not approved"
Wait 24-48 hours after applying for API access.

### "Invalid customer ID"
Remove dashes from Customer ID. Use `1234567890` not `123-456-7890`.

### "Insufficient permissions"
Make sure the Google account you authorized has admin access to the Google Ads account.

### No data showing
1. Check that your Google Ads account has campaigns with data
2. Try syncing a broader date range
3. Check Netlify function logs for errors

## What Data Gets Synced?

The sync pulls these metrics daily by campaign:
- Impressions
- Clicks
- Cost
- Conversions (leads)
- Conversion value (revenue)

Data is automatically classified into campaign types:
- **Interviews**: Campaigns with "interview" in the name
- **Contacts**: Campaigns with "contact" in the name
- **General**: All other campaigns

## Customization

To customize campaign classification, edit the `classifyCampaign()` function in:
`netlify/functions/google-ads-sync.js`

## File Reference

- **Setup Guide**: `GOOGLE_ADS_SETUP.md` (detailed documentation)
- **API Client**: `netlify/functions/utils/google-ads-client.js`
- **Sync Function**: `netlify/functions/google-ads-sync.js`
- **OAuth Init**: `netlify/functions/google-ads-oauth-init.js`
- **OAuth Callback**: `netlify/functions/google-ads-oauth-callback.js`
- **Test Endpoint**: `netlify/functions/google-ads-sync-test.js`

## Support

For detailed information, see `GOOGLE_ADS_SETUP.md`.

For Google Ads API documentation: https://developers.google.com/google-ads/api/docs/start
