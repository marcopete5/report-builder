// Google Ads API Client Utility
// Handles authentication and API requests to Google Ads

const https = require('https');

/**
 * Get Google Ads API configuration from environment variables
 */
function getConfig() {
    return {
        clientId: process.env.GOOGLE_ADS_CLIENT_ID,
        clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
        refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
        loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null
    };
}

/**
 * Validate that all required configuration is present
 */
function validateConfig(config) {
    const required = ['clientId', 'clientSecret', 'developerToken', 'customerId', 'refreshToken'];
    const missing = required.filter(key => !config[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required Google Ads configuration: ${missing.join(', ')}`);
    }
}

/**
 * Get a fresh access token using the refresh token
 */
async function getAccessToken(config) {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: config.refreshToken,
            grant_type: 'refresh_token'
        }).toString();

        const options = {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.access_token) {
                        resolve(result.access_token);
                    } else {
                        reject(new Error('No access token in response: ' + data));
                    }
                } catch (err) {
                    reject(new Error('Failed to parse token response: ' + err.message));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error('Token request failed: ' + err.message));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Execute a Google Ads query using the Search API
 * @param {string} query - GAQL (Google Ads Query Language) query
 * @param {Object} options - Optional parameters
 * @returns {Promise<Array>} Array of result rows
 */
async function executeQuery(query, options = {}) {
    const config = getConfig();
    validateConfig(config);

    const accessToken = await getAccessToken(config);
    const customerId = options.customerId || config.customerId;

    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({ query });

        // Remove dashes from customer ID if present
        const cleanCustomerId = customerId.toString().replace(/-/g, '');

        const requestOptions = {
            hostname: 'googleads.googleapis.com',
            path: `/v22/customers/${cleanCustomerId}/googleAds:search`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': config.developerToken,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        // Add login-customer-id if using a manager account
        if (config.loginCustomerId) {
            requestOptions.headers['login-customer-id'] = config.loginCustomerId;
        }

        const req = https.request(requestOptions, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(data);

                    if (res.statusCode >= 400) {
                        reject(new Error(`Google Ads API error (${res.statusCode}): ${JSON.stringify(result)}`));
                        return;
                    }

                    // Return the results array
                    resolve(result.results || []);
                } catch (err) {
                    reject(new Error('Failed to parse API response: ' + err.message));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error('API request failed: ' + err.message));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Get campaign performance metrics for a date range
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<Array>} Campaign performance data
 */
async function getCampaignPerformance(startDate, endDate) {
    // Format dates for Google Ads (YYYYMMDD)
    const formattedStartDate = startDate.replace(/-/g, '');
    const formattedEndDate = endDate.replace(/-/g, '');

    const query = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
            AND campaign.status != 'REMOVED'
        ORDER BY segments.date ASC
    `;

    const results = await executeQuery(query);

    // Transform results into a more usable format
    return results.map(row => {
        const campaign = row.campaign || {};
        const segments = row.segments || {};
        const metrics = row.metrics || {};

        return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            campaignStatus: campaign.status,
            date: segments.date,
            impressions: parseInt(metrics.impressions) || 0,
            clicks: parseInt(metrics.clicks) || 0,
            cost: parseFloat(metrics.costMicros) / 1000000 || 0, // Convert micros to dollars
            conversions: parseFloat(metrics.conversions) || 0,
            conversionsValue: parseFloat(metrics.conversionsValue) || 0
        };
    });
}

/**
 * Get ad group performance metrics for a date range
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<Array>} Ad group performance data
 */
async function getAdGroupPerformance(startDate, endDate) {
    const formattedStartDate = startDate.replace(/-/g, '');
    const formattedEndDate = endDate.replace(/-/g, '');

    const query = `
        SELECT
            campaign.id,
            campaign.name,
            ad_group.id,
            ad_group.name,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
        FROM ad_group
        WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
            AND campaign.status != 'REMOVED'
            AND ad_group.status != 'REMOVED'
        ORDER BY segments.date ASC
    `;

    const results = await executeQuery(query);

    return results.map(row => {
        const campaign = row.campaign || {};
        const adGroup = row.adGroup || {};
        const segments = row.segments || {};
        const metrics = row.metrics || {};

        return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            adGroupId: adGroup.id,
            adGroupName: adGroup.name,
            date: segments.date,
            impressions: parseInt(metrics.impressions) || 0,
            clicks: parseInt(metrics.clicks) || 0,
            cost: parseFloat(metrics.costMicros) / 1000000 || 0,
            conversions: parseFloat(metrics.conversions) || 0
        };
    });
}

/**
 * Get account-level performance summary
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} Account performance summary
 */
async function getAccountSummary(startDate, endDate) {
    const formattedStartDate = startDate.replace(/-/g, '');
    const formattedEndDate = endDate.replace(/-/g, '');

    const query = `
        SELECT
            customer.id,
            customer.descriptive_name,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
    `;

    const results = await executeQuery(query);

    if (results.length === 0) {
        return null;
    }

    const row = results[0];
    const customer = row.customer || {};
    const metrics = row.metrics || {};

    return {
        customerId: customer.id,
        accountName: customer.descriptiveName,
        impressions: parseInt(metrics.impressions) || 0,
        clicks: parseInt(metrics.clicks) || 0,
        cost: parseFloat(metrics.costMicros) / 1000000 || 0,
        conversions: parseFloat(metrics.conversions) || 0,
        conversionsValue: parseFloat(metrics.conversionsValue) || 0
    };
}

/**
 * Test the Google Ads API connection
 * @returns {Promise<Object>} Connection test results
 */
async function testConnection() {
    const config = getConfig();

    try {
        validateConfig(config);
    } catch (err) {
        return {
            success: false,
            error: err.message,
            config: {
                hasClientId: !!config.clientId,
                hasClientSecret: !!config.clientSecret,
                hasDeveloperToken: !!config.developerToken,
                hasCustomerId: !!config.customerId,
                hasRefreshToken: !!config.refreshToken
            }
        };
    }

    try {
        const accessToken = await getAccessToken(config);

        // Try to fetch basic account info
        const query = `
            SELECT
                customer.id,
                customer.descriptive_name
            FROM customer
            LIMIT 1
        `;

        const results = await executeQuery(query);

        return {
            success: true,
            message: 'Successfully connected to Google Ads API',
            account: results[0]?.customer || {},
            accessTokenObtained: true
        };
    } catch (err) {
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * Get campaign performance with conversion action breakdown
 * This requires two separate queries due to Google Ads API restrictions
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} Campaign performance and conversion data
 */
async function getCampaignPerformanceWithConversions(startDate, endDate) {
    const formattedStartDate = startDate.replace(/-/g, '');
    const formattedEndDate = endDate.replace(/-/g, '');

    // Query 1: Get campaign performance metrics (impressions, clicks, cost)
    const performanceQuery = `
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros
        FROM campaign
        WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
            AND campaign.status != 'REMOVED'
        ORDER BY segments.date ASC
    `;

    // Query 2: Get conversion breakdown by action
    const conversionsQuery = `
        SELECT
            campaign.id,
            campaign.name,
            segments.date,
            segments.conversion_action_name,
            metrics.conversions,
            metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
            AND campaign.status != 'REMOVED'
        ORDER BY segments.date ASC
    `;

    const [performanceResults, conversionResults] = await Promise.all([
        executeQuery(performanceQuery),
        executeQuery(conversionsQuery)
    ]);

    // Transform performance data
    const performanceData = performanceResults.map(row => {
        const campaign = row.campaign || {};
        const segments = row.segments || {};
        const metrics = row.metrics || {};

        return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            campaignStatus: campaign.status,
            date: segments.date,
            impressions: parseInt(metrics.impressions) || 0,
            clicks: parseInt(metrics.clicks) || 0,
            cost: parseFloat(metrics.costMicros) / 1000000 || 0
        };
    });

    // Transform conversion data
    const conversionData = conversionResults.map(row => {
        const campaign = row.campaign || {};
        const segments = row.segments || {};
        const metrics = row.metrics || {};

        return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            date: segments.date,
            conversionActionName: segments.conversionActionName,
            conversions: parseFloat(metrics.conversions) || 0,
            conversionsValue: parseFloat(metrics.conversionsValue) || 0
        };
    });

    return {
        performance: performanceData,
        conversions: conversionData
    };
}

module.exports = {
    getConfig,
    validateConfig,
    getAccessToken,
    executeQuery,
    getCampaignPerformance,
    getCampaignPerformanceWithConversions,
    getAdGroupPerformance,
    getAccountSummary,
    testConnection
};
