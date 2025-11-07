// /.netlify/functions/google-ads-sync-test
// Tests Google Ads API connection and displays sample data

const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { testConnection, getCampaignPerformance } = require('./utils/google-ads-client');

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
        // Test basic connection
        console.log('Testing Google Ads API connection...');
        const connectionTest = await testConnection();

        if (!connectionTest.success) {
            return {
                statusCode: 500,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/html'
                },
                body: renderErrorPage(connectionTest.error, connectionTest.config)
            };
        }

        // Fetch sample data (last 7 days)
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        console.log(`Fetching sample data from ${startDate} to ${endDate}...`);
        const campaignData = await getCampaignPerformance(startDate, endDate);

        // Calculate summary stats
        const summary = campaignData.reduce((acc, row) => {
            acc.totalImpressions += row.impressions;
            acc.totalClicks += row.clicks;
            acc.totalCost += row.cost;
            acc.totalConversions += row.conversions;
            return acc;
        }, {
            totalImpressions: 0,
            totalClicks: 0,
            totalCost: 0,
            totalConversions: 0
        });

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: renderSuccessPage(connectionTest, campaignData, summary, startDate, endDate)
        };
    } catch (err) {
        console.error('Test error:', err);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: renderErrorPage(err.message)
        };
    }
};

function renderErrorPage(error, config) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Ads Connection Test - Error</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 800px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f7fa;
                }
                .error {
                    background: white;
                    border: 1px solid #e1e4e8;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 { color: #d73a49; }
                .error-box {
                    background: #ffeef0;
                    border: 1px solid #d73a49;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 20px 0;
                    word-break: break-word;
                }
                .config-check {
                    background: #fff3cd;
                    border: 1px solid #ffc107;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 20px 0;
                }
                ul { list-style: none; padding: 0; }
                li { margin: 8px 0; }
                .check-icon { margin-right: 8px; }
                .missing { color: #d73a49; }
                .present { color: #28a745; }
                code {
                    background: #f6f8fa;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 13px;
                }
            </style>
        </head>
        <body>
            <div class="error">
                <h1>✗ Google Ads Connection Failed</h1>
                <div class="error-box">
                    <strong>Error:</strong> ${error}
                </div>

                ${config ? `
                <div class="config-check">
                    <h3>Configuration Status:</h3>
                    <ul>
                        <li class="${config.hasClientId ? 'present' : 'missing'}">
                            <span class="check-icon">${config.hasClientId ? '✓' : '✗'}</span>
                            <code>GOOGLE_ADS_CLIENT_ID</code>
                        </li>
                        <li class="${config.hasClientSecret ? 'present' : 'missing'}">
                            <span class="check-icon">${config.hasClientSecret ? '✓' : '✗'}</span>
                            <code>GOOGLE_ADS_CLIENT_SECRET</code>
                        </li>
                        <li class="${config.hasDeveloperToken ? 'present' : 'missing'}">
                            <span class="check-icon">${config.hasDeveloperToken ? '✓' : '✗'}</span>
                            <code>GOOGLE_ADS_DEVELOPER_TOKEN</code>
                        </li>
                        <li class="${config.hasCustomerId ? 'present' : 'missing'}">
                            <span class="check-icon">${config.hasCustomerId ? '✓' : '✗'}</span>
                            <code>GOOGLE_ADS_CUSTOMER_ID</code>
                        </li>
                        <li class="${config.hasRefreshToken ? 'present' : 'missing'}">
                            <span class="check-icon">${config.hasRefreshToken ? '✓' : '✗'}</span>
                            <code>GOOGLE_ADS_REFRESH_TOKEN</code>
                        </li>
                    </ul>
                </div>
                ` : ''}

                <h3>Next Steps:</h3>
                <ol>
                    <li>Check the <code>GOOGLE_ADS_SETUP.md</code> file for setup instructions</li>
                    <li>Ensure all environment variables are set in Netlify</li>
                    <li>If you haven't completed the OAuth flow, visit: <code>/.netlify/functions/google-ads-oauth-init</code></li>
                </ol>
            </div>
        </body>
        </html>
    `;
}

function renderSuccessPage(connectionTest, campaignData, summary, startDate, endDate) {
    const sampleRows = campaignData.slice(0, 10);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Ads Connection Test - Success</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 1200px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f7fa;
                }
                .success {
                    background: white;
                    border: 1px solid #e1e4e8;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 { color: #28a745; }
                .info-box {
                    background: #e6ffed;
                    border: 1px solid #28a745;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 20px 0;
                }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin: 20px 0;
                }
                .summary-card {
                    background: #f6f8fa;
                    border: 1px solid #d1d5da;
                    border-radius: 6px;
                    padding: 15px;
                }
                .summary-label {
                    font-size: 12px;
                    color: #586069;
                    text-transform: uppercase;
                    font-weight: 600;
                    margin-bottom: 5px;
                }
                .summary-value {
                    font-size: 24px;
                    font-weight: 700;
                    color: #24292e;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 20px 0;
                    font-size: 14px;
                }
                th, td {
                    text-align: left;
                    padding: 12px;
                    border-bottom: 1px solid #e1e4e8;
                }
                th {
                    background: #f6f8fa;
                    font-weight: 600;
                    color: #24292e;
                }
                tr:hover {
                    background: #f6f8fa;
                }
                code {
                    background: #f6f8fa;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 13px;
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
            </style>
        </head>
        <body>
            <div class="success">
                <h1>✓ Google Ads API Connected Successfully!</h1>
                <div class="info-box">
                    <p><strong>Account:</strong> ${connectionTest.account.descriptiveName || connectionTest.account.id || 'N/A'}</p>
                    <p><strong>Customer ID:</strong> ${connectionTest.account.id || 'N/A'}</p>
                    <p><strong>Date Range:</strong> ${startDate} to ${endDate}</p>
                    <p><strong>Records Retrieved:</strong> ${campaignData.length} campaign-day combinations</p>
                </div>

                <h2>Summary (Last 7 Days)</h2>
                <div class="summary">
                    <div class="summary-card">
                        <div class="summary-label">Impressions</div>
                        <div class="summary-value">${summary.totalImpressions.toLocaleString()}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Clicks</div>
                        <div class="summary-value">${summary.totalClicks.toLocaleString()}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Cost</div>
                        <div class="summary-value">$${summary.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-label">Conversions</div>
                        <div class="summary-value">${summary.totalConversions.toLocaleString()}</div>
                    </div>
                </div>

                <h2>Sample Data (First 10 Rows)</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Campaign</th>
                            <th>Impressions</th>
                            <th>Clicks</th>
                            <th>Cost</th>
                            <th>Conversions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sampleRows.map(row => `
                            <tr>
                                <td>${row.date}</td>
                                <td>${row.campaignName}</td>
                                <td>${row.impressions.toLocaleString()}</td>
                                <td>${row.clicks.toLocaleString()}</td>
                                <td>$${row.cost.toFixed(2)}</td>
                                <td>${row.conversions}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <h2>Next Steps</h2>
                <p>Your Google Ads API connection is working! You can now:</p>
                <a href="/.netlify/functions/google-ads-sync" class="btn">Sync Data to Database</a>
                <a href="/dashboard-ad-spend.html" class="btn">View Dashboard</a>

                <p style="margin-top: 20px; color: #586069; font-size: 14px;">
                    <strong>Note:</strong> To automatically sync data daily, set up a scheduled function in your <code>netlify.toml</code> file.
                    See <code>GOOGLE_ADS_SETUP.md</code> for instructions.
                </p>
            </div>
        </body>
        </html>
    `;
}
