# Google Ads API Setup Guide

This guide will help you set up the Google Ads API to automatically fetch ad performance data for the Millersville Ads Dashboard.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Name it something like "V-School-Ad-Dashboard"

## Step 2: Enable Google Ads API

1. In your Google Cloud project, go to **APIs & Services > Library**
2. Search for "Google Ads API"
3. Click on it and click **Enable**

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - User Type: Internal (if using Google Workspace) or External
   - App name: "V School Ad Dashboard"
   - User support email: Your email
   - Developer contact: Your email
   - Scopes: Add `https://www.googleapis.com/auth/adwords`
4. Create OAuth client ID:
   - Application type: **Web application**
   - Name: "V School Ad Dashboard"
   - Authorized redirect URIs: Add your callback URL
     - For local development: `http://localhost:8888/.netlify/functions/google-ads-oauth-callback`
     - For production: `https://yourdomain.com/.netlify/functions/google-ads-oauth-callback`
5. Download the JSON credentials file (you'll need the Client ID and Client Secret)

## Step 4: Apply for Google Ads API Access

1. Go to [Google Ads API Center](https://ads.google.com/aw/apicenter)
2. Complete the API access request form
3. Wait for approval (usually 24-48 hours)
4. Once approved, note your **Developer Token**

## Step 5: Get Your Google Ads Customer ID

1. Log into your Google Ads account at [ads.google.com](https://ads.google.com)
2. Look at the top right corner - you'll see a number like `123-456-7890`
3. Remove the dashes to get your Customer ID: `1234567890`

## Step 6: Set Up Environment Variables

Add these to your Netlify environment variables (or `.env` file for local development):

```bash
# Google Ads API Credentials
GOOGLE_ADS_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_ADS_CLIENT_SECRET=your-client-secret
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_REFRESH_TOKEN=  # Will be generated in Step 7

# Optional: Login Customer ID (only if using a manager account)
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

### Setting Environment Variables in Netlify:

1. Go to your Netlify site dashboard
2. Navigate to **Site settings > Environment variables**
3. Click **Add a variable**
4. Add each variable listed above

## Step 7: Generate Refresh Token (OAuth Flow)

You need to complete the OAuth flow once to get a refresh token. We've created an endpoint to help with this:

### Option A: Use the Built-in OAuth Flow (Recommended)

1. Deploy your site to Netlify with the Client ID, Client Secret, and Developer Token
2. As a superadmin user, visit: `https://your-site.netlify.app/.netlify/functions/google-ads-oauth-init`
3. This will redirect you to Google to authorize the app
4. After authorization, you'll be redirected back and the refresh token will be displayed
5. Copy the refresh token and add it to your Netlify environment variables as `GOOGLE_ADS_REFRESH_TOKEN`

### Option B: Use Google's OAuth Playground (Manual Method)

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in the top right
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. In "Step 1", scroll down and select `https://www.googleapis.com/auth/adwords`
6. Click "Authorize APIs"
7. Sign in with the Google account that has access to your Google Ads account
8. In "Step 2", click "Exchange authorization code for tokens"
9. Copy the **Refresh token** and add it to your environment variables

## Step 8: Test the Connection

Once you've set up all environment variables:

1. Visit: `https://your-site.netlify.app/.netlify/functions/google-ads-sync-test`
2. This will test your connection and fetch a sample of data
3. If successful, you'll see recent campaign performance metrics

## Step 9: Set Up Automatic Data Sync

We've created a sync function that runs automatically. You can trigger it manually or set up a scheduled function:

### Manual Sync:
Visit: `https://your-site.netlify.app/.netlify/functions/google-ads-sync`

### Automatic Sync (Recommended):
Set up a Netlify Scheduled Function:

1. In your `netlify.toml`, add:
```toml
[functions."google-ads-sync"]
  schedule = "@daily"  # Runs once per day at midnight UTC
```

2. Or use a cron expression for more control:
```toml
[functions."google-ads-sync"]
  schedule = "0 2 * * *"  # Runs at 2:00 AM UTC every day
```

## Troubleshooting

### "Developer token is not approved"
- You need to wait for Google to approve your API access request
- This can take 24-48 hours

### "Customer ID is invalid"
- Make sure you're using the Customer ID without dashes
- Example: Use `1234567890` instead of `123-456-7890`

### "Insufficient permissions"
- Ensure the Google account you authorized has admin access to the Google Ads account
- Check that you selected the correct scope: `https://www.googleapis.com/auth/adwords`

### "Invalid refresh token"
- The refresh token may have expired or been revoked
- Re-run the OAuth flow (Step 7) to get a new refresh token

## Data Structure

The sync function will create records in the `ad_spend` collection with this structure:

```javascript
{
  date: Date,                    // Date of the metrics
  impressions: Number,           // Number of impressions
  clicks: Number,                // Number of clicks
  cost: Number,                  // Cost in dollars (converted from micros)
  leads: Number,                 // Conversions (leads)
  conversions: Number,           // Same as leads
  campaign_type: String,         // "interviews", "contacts", or "general"
  campaign: String,              // Campaign name
  campaign_id: String,           // Google Ads campaign ID
  platform: String,              // "Google Ads"
  synced_at: Date,              // When this record was synced
  source: "google_ads"           // Data source identifier
}
```

## Campaign Classification

The system automatically classifies campaigns based on their names:
- If campaign name contains "interview" → `campaign_type: "interviews"`
- If campaign name contains "contact" → `campaign_type: "contacts"`
- Otherwise → `campaign_type: "general"`

You can customize this logic in the `classifyCampaign()` function in `google-ads-sync.js`.

## Next Steps

After setup is complete:
1. The dashboard will automatically use real Google Ads data
2. Data syncs daily (or on your configured schedule)
3. You can manually trigger a sync anytime via the sync endpoint
4. Historical data can be backfilled by specifying a date range

## Support

If you encounter issues:
1. Check Netlify Function logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure your Google Ads account has data for the date range you're querying
4. Review the [Google Ads API documentation](https://developers.google.com/google-ads/api/docs/start)
