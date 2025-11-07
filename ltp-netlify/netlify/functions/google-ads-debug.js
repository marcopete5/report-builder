// /.netlify/functions/google-ads-debug
// Debug Google Ads API configuration

const https = require('https');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { getConfig } = require('./utils/google-ads-client');

/**
 * Test getting an access token with verbose logging
 */
async function debugAccessToken(config) {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: config.refreshToken,
            grant_type: 'refresh_token'
        }).toString();

        console.log('Token request config:', {
            hasClientId: !!config.clientId,
            hasClientSecret: !!config.clientSecret,
            hasRefreshToken: !!config.refreshToken,
            clientIdStart: config.clientId?.substring(0, 20) + '...',
            refreshTokenStart: config.refreshToken?.substring(0, 20) + '...'
        });

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
                console.log('Token response status:', res.statusCode);
                console.log('Token response data:', data);

                try {
                    const result = JSON.parse(data);
                    resolve({
                        success: !!result.access_token,
                        statusCode: res.statusCode,
                        data: result,
                        hasAccessToken: !!result.access_token,
                        error: result.error,
                        errorDescription: result.error_description
                    });
                } catch (err) {
                    resolve({
                        success: false,
                        statusCode: res.statusCode,
                        rawData: data,
                        parseError: err.message
                    });
                }
            });
        });

        req.on('error', (err) => {
            reject({
                success: false,
                error: 'Request failed: ' + err.message
            });
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Test a simple Google Ads API call with verbose logging
 */
async function debugApiCall(accessToken, config) {
    return new Promise((resolve, reject) => {
        // Try simpler query first - just get accessible customers
        const query = `
            SELECT
                customer_client.client_customer,
                customer_client.level,
                customer_client.manager,
                customer_client.descriptive_name,
                customer_client.currency_code,
                customer_client.time_zone,
                customer_client.id
            FROM customer_client
            WHERE customer_client.level <= 1
        `;

        const requestBody = JSON.stringify({ query });

        // Remove dashes from customer ID if present
        const cleanCustomerId = config.customerId.toString().replace(/-/g, '');

        console.log('API request config:', {
            hasAccessToken: !!accessToken,
            hasDeveloperToken: !!config.developerToken,
            hasCustomerId: !!config.customerId,
            customerId: config.customerId,
            cleanCustomerId: cleanCustomerId,
            developerTokenStart: config.developerToken?.substring(0, 10) + '...'
        });

        const requestOptions = {
            hostname: 'googleads.googleapis.com',
            path: `/v18/customers/${cleanCustomerId}/googleAds:search`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': config.developerToken,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        if (config.loginCustomerId) {
            requestOptions.headers['login-customer-id'] = config.loginCustomerId;
        }

        console.log('Making API request to:', requestOptions.hostname + requestOptions.path);

        const req = https.request(requestOptions, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('API response status:', res.statusCode);
                console.log('API response headers:', res.headers);
                console.log('API response data:', data.substring(0, 500));

                try {
                    const result = JSON.parse(data);
                    resolve({
                        success: res.statusCode < 400,
                        statusCode: res.statusCode,
                        data: result,
                        error: result.error
                    });
                } catch (err) {
                    resolve({
                        success: false,
                        statusCode: res.statusCode,
                        rawData: data.substring(0, 1000),
                        parseError: err.message,
                        isHtml: data.trim().startsWith('<')
                    });
                }
            });
        });

        req.on('error', (err) => {
            reject({
                success: false,
                error: 'API request failed: ' + err.message
            });
        });

        req.write(requestBody);
        req.end();
    });
}

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const config = getConfig();

        // Check environment variables
        const envCheck = {
            GOOGLE_ADS_CLIENT_ID: {
                exists: !!config.clientId,
                value: config.clientId ? config.clientId.substring(0, 30) + '...' : null
            },
            GOOGLE_ADS_CLIENT_SECRET: {
                exists: !!config.clientSecret,
                length: config.clientSecret?.length
            },
            GOOGLE_ADS_DEVELOPER_TOKEN: {
                exists: !!config.developerToken,
                value: config.developerToken ? config.developerToken.substring(0, 15) + '...' : null
            },
            GOOGLE_ADS_CUSTOMER_ID: {
                exists: !!config.customerId,
                value: config.customerId,
                isNumeric: config.customerId ? /^\d+$/.test(config.customerId) : false,
                hasDashes: config.customerId ? config.customerId.includes('-') : false
            },
            GOOGLE_ADS_REFRESH_TOKEN: {
                exists: !!config.refreshToken,
                length: config.refreshToken?.length,
                startsWithCorrect: config.refreshToken ? config.refreshToken.startsWith('1//') : false
            },
            GOOGLE_ADS_LOGIN_CUSTOMER_ID: {
                exists: !!config.loginCustomerId,
                value: config.loginCustomerId
            }
        };

        console.log('Environment check:', envCheck);

        // Test 1: Get access token
        let tokenResult;
        try {
            tokenResult = await debugAccessToken(config);
        } catch (err) {
            tokenResult = err;
        }

        // Test 2: If we got a token, try API call
        let apiResult = null;
        if (tokenResult.success && tokenResult.data?.access_token) {
            try {
                apiResult = await debugApiCall(tokenResult.data.access_token, config);
            } catch (err) {
                apiResult = err;
            }
        }

        // Return diagnostic info
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: renderDebugPage(envCheck, tokenResult, apiResult)
        };
    } catch (err) {
        console.error('Debug error:', err);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: err.message,
                stack: err.stack
            })
        };
    }
};

function renderDebugPage(envCheck, tokenResult, apiResult) {
    const issues = [];

    // Check for common issues
    if (!envCheck.GOOGLE_ADS_CLIENT_ID.exists) {
        issues.push('❌ GOOGLE_ADS_CLIENT_ID is missing');
    }
    if (!envCheck.GOOGLE_ADS_CLIENT_SECRET.exists) {
        issues.push('❌ GOOGLE_ADS_CLIENT_SECRET is missing');
    }
    if (!envCheck.GOOGLE_ADS_DEVELOPER_TOKEN.exists) {
        issues.push('❌ GOOGLE_ADS_DEVELOPER_TOKEN is missing');
    }
    if (!envCheck.GOOGLE_ADS_CUSTOMER_ID.exists) {
        issues.push('❌ GOOGLE_ADS_CUSTOMER_ID is missing');
    } else if (envCheck.GOOGLE_ADS_CUSTOMER_ID.hasDashes) {
        issues.push('⚠️ GOOGLE_ADS_CUSTOMER_ID contains dashes - remove them! Use 1234567890 not 123-456-7890');
    } else if (!envCheck.GOOGLE_ADS_CUSTOMER_ID.isNumeric) {
        issues.push('⚠️ GOOGLE_ADS_CUSTOMER_ID should be numeric only');
    }
    if (!envCheck.GOOGLE_ADS_REFRESH_TOKEN.exists) {
        issues.push('❌ GOOGLE_ADS_REFRESH_TOKEN is missing - you need to complete the OAuth flow');
    } else if (!envCheck.GOOGLE_ADS_REFRESH_TOKEN.startsWithCorrect) {
        issues.push('⚠️ GOOGLE_ADS_REFRESH_TOKEN might be invalid - it should start with "1//"');
    }

    if (!tokenResult.success) {
        if (tokenResult.error === 'invalid_grant') {
            issues.push('❌ Refresh token is invalid or expired - you need to re-do the OAuth flow');
        } else if (tokenResult.error) {
            issues.push(`❌ OAuth error: ${tokenResult.error} - ${tokenResult.errorDescription || ''}`);
        }
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Ads API Debug</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 1200px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f7fa;
                }
                .debug {
                    background: white;
                    border: 1px solid #e1e4e8;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 { color: #24292e; margin-bottom: 20px; }
                h2 {
                    color: #24292e;
                    margin-top: 30px;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #e1e4e8;
                }
                .section {
                    background: #f6f8fa;
                    border: 1px solid #d1d5da;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 15px 0;
                }
                .success {
                    background: #e6ffed;
                    border-color: #28a745;
                }
                .error {
                    background: #ffeef0;
                    border-color: #d73a49;
                }
                .warning {
                    background: #fff3cd;
                    border-color: #ffc107;
                }
                pre {
                    background: #24292e;
                    color: #e1e4e8;
                    padding: 15px;
                    border-radius: 6px;
                    overflow-x: auto;
                    font-size: 12px;
                }
                .issue-list {
                    list-style: none;
                    padding: 0;
                }
                .issue-list li {
                    padding: 8px 0;
                    border-bottom: 1px solid #e1e4e8;
                }
                .issue-list li:last-child {
                    border-bottom: none;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 10px 0;
                }
                th, td {
                    text-align: left;
                    padding: 10px;
                    border-bottom: 1px solid #e1e4e8;
                }
                th {
                    background: #f6f8fa;
                    font-weight: 600;
                }
                .btn {
                    display: inline-block;
                    padding: 10px 20px;
                    background: #2ea44f;
                    color: white;
                    text-decoration: none;
                    border-radius: 6px;
                    font-weight: 600;
                    margin: 10px 10px 10px 0;
                }
                .btn:hover {
                    background: #2c974b;
                }
                code {
                    background: #f6f8fa;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 13px;
                    color: #d73a49;
                }
            </style>
        </head>
        <body>
            <div class="debug">
                <h1>🔍 Google Ads API Debug Report</h1>

                ${issues.length > 0 ? `
                <div class="section error">
                    <h3>❌ Issues Found</h3>
                    <ul class="issue-list">
                        ${issues.map(issue => `<li>${issue}</li>`).join('')}
                    </ul>
                </div>
                ` : `
                <div class="section success">
                    <h3>✅ All Configuration Checks Passed</h3>
                </div>
                `}

                <h2>1. Environment Variables</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Variable</th>
                            <th>Status</th>
                            <th>Value/Info</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><code>GOOGLE_ADS_CLIENT_ID</code></td>
                            <td>${envCheck.GOOGLE_ADS_CLIENT_ID.exists ? '✅' : '❌'}</td>
                            <td>${envCheck.GOOGLE_ADS_CLIENT_ID.value || 'Not set'}</td>
                        </tr>
                        <tr>
                            <td><code>GOOGLE_ADS_CLIENT_SECRET</code></td>
                            <td>${envCheck.GOOGLE_ADS_CLIENT_SECRET.exists ? '✅' : '❌'}</td>
                            <td>${envCheck.GOOGLE_ADS_CLIENT_SECRET.exists ? `Set (${envCheck.GOOGLE_ADS_CLIENT_SECRET.length} chars)` : 'Not set'}</td>
                        </tr>
                        <tr>
                            <td><code>GOOGLE_ADS_DEVELOPER_TOKEN</code></td>
                            <td>${envCheck.GOOGLE_ADS_DEVELOPER_TOKEN.exists ? '✅' : '❌'}</td>
                            <td>${envCheck.GOOGLE_ADS_DEVELOPER_TOKEN.value || 'Not set'}</td>
                        </tr>
                        <tr>
                            <td><code>GOOGLE_ADS_CUSTOMER_ID</code></td>
                            <td>${envCheck.GOOGLE_ADS_CUSTOMER_ID.exists ? (envCheck.GOOGLE_ADS_CUSTOMER_ID.isNumeric ? '✅' : '⚠️') : '❌'}</td>
                            <td>${envCheck.GOOGLE_ADS_CUSTOMER_ID.value || 'Not set'} ${envCheck.GOOGLE_ADS_CUSTOMER_ID.hasDashes ? '<br><strong style="color: #d73a49;">⚠️ Remove dashes!</strong>' : ''}</td>
                        </tr>
                        <tr>
                            <td><code>GOOGLE_ADS_REFRESH_TOKEN</code></td>
                            <td>${envCheck.GOOGLE_ADS_REFRESH_TOKEN.exists ? (envCheck.GOOGLE_ADS_REFRESH_TOKEN.startsWithCorrect ? '✅' : '⚠️') : '❌'}</td>
                            <td>${envCheck.GOOGLE_ADS_REFRESH_TOKEN.exists ? `Set (${envCheck.GOOGLE_ADS_REFRESH_TOKEN.length} chars)` : 'Not set - <a href="/.netlify/functions/google-ads-oauth-init">Complete OAuth</a>'}</td>
                        </tr>
                        <tr>
                            <td><code>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code></td>
                            <td>${envCheck.GOOGLE_ADS_LOGIN_CUSTOMER_ID.exists ? '✅' : 'ℹ️'}</td>
                            <td>${envCheck.GOOGLE_ADS_LOGIN_CUSTOMER_ID.value || 'Not set (optional)'}</td>
                        </tr>
                    </tbody>
                </table>

                <h2>2. OAuth Token Test</h2>
                <div class="section ${tokenResult.success ? 'success' : 'error'}">
                    <strong>Status:</strong> ${tokenResult.success ? '✅ Success' : '❌ Failed'}<br>
                    <strong>Status Code:</strong> ${tokenResult.statusCode || 'N/A'}<br>
                    ${tokenResult.error ? `<strong>Error:</strong> ${tokenResult.error}<br>` : ''}
                    ${tokenResult.errorDescription ? `<strong>Description:</strong> ${tokenResult.errorDescription}<br>` : ''}
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer;">Raw Response</summary>
                        <pre>${JSON.stringify(tokenResult, null, 2)}</pre>
                    </details>
                </div>

                ${apiResult ? `
                <h2>3. Google Ads API Test</h2>
                <div class="section ${apiResult.success ? 'success' : 'error'}">
                    <strong>Status:</strong> ${apiResult.success ? '✅ Success' : '❌ Failed'}<br>
                    <strong>Status Code:</strong> ${apiResult.statusCode || 'N/A'}<br>
                    ${apiResult.isHtml ? '<strong style="color: #d73a49;">⚠️ API returned HTML instead of JSON - check credentials</strong><br>' : ''}
                    ${apiResult.error ? `<strong>Error:</strong> ${JSON.stringify(apiResult.error)}<br>` : ''}
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer;">Raw Response</summary>
                        <pre>${JSON.stringify(apiResult, null, 2)}</pre>
                    </details>
                </div>
                ` : ''}

                <h2>Next Steps</h2>
                ${issues.length > 0 ? `
                    <p>Fix the issues listed above, then:</p>
                ` : ''}
                <a href="/.netlify/functions/google-ads-oauth-init" class="btn">Complete OAuth Flow</a>
                <a href="/.netlify/functions/google-ads-debug" class="btn">Re-run Debug</a>
                <a href="/.netlify/functions/google-ads-sync-test" class="btn">Test Connection</a>
            </div>
        </body>
        </html>
    `;
}
