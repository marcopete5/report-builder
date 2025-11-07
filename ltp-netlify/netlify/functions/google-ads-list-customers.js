// /.netlify/functions/google-ads-list-customers
// Lists accessible Google Ads customer accounts

const https = require('https');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');
const { getConfig, getAccessToken } = require('./utils/google-ads-client');

/**
 * List accessible customers using the ListAccessibleCustomers API
 */
async function listAccessibleCustomers(accessToken) {
    return new Promise((resolve, reject) => {
        const requestOptions = {
            hostname: 'googleads.googleapis.com',
            path: '/v18/customers:listAccessibleCustomers',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN
            }
        };

        console.log('Listing accessible customers...');

        const req = https.request(requestOptions, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('Response status:', res.statusCode);
                console.log('Response data:', data);

                try {
                    const result = JSON.parse(data);

                    if (res.statusCode >= 400) {
                        resolve({
                            success: false,
                            statusCode: res.statusCode,
                            error: result.error || result
                        });
                        return;
                    }

                    resolve({
                        success: true,
                        statusCode: res.statusCode,
                        customers: result.resourceNames || [],
                        data: result
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

        // Get access token
        const accessToken = await getAccessToken(config);

        // List accessible customers
        const result = await listAccessibleCustomers(accessToken);

        // Extract customer IDs from resource names
        const customerIds = result.customers ? result.customers.map(name => {
            // Resource names are like: customers/1234567890
            const match = name.match(/customers\/(\d+)/);
            return match ? match[1] : null;
        }).filter(Boolean) : [];

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: renderPage(result, customerIds, config)
        };
    } catch (err) {
        console.error('Error:', err);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Error</title>
                    <style>
                        body { font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                        .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 5px; }
                    </style>
                </head>
                <body>
                    <div class="error">
                        <h1>Error</h1>
                        <pre>${err.message}\n\n${err.stack}</pre>
                    </div>
                </body>
                </html>
            `
        };
    }
};

function renderPage(result, customerIds, config) {
    const currentCustomerId = config.customerId;

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Ads - Accessible Customers</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 900px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f7fa;
                }
                .container {
                    background: white;
                    border: 1px solid #e1e4e8;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 { color: #24292e; margin-bottom: 20px; }
                .${result.success ? 'success' : 'error'} {
                    background: ${result.success ? '#e6ffed' : '#ffeef0'};
                    border: 1px solid ${result.success ? '#28a745' : '#d73a49'};
                    border-radius: 6px;
                    padding: 15px;
                    margin: 20px 0;
                }
                .customer-list {
                    list-style: none;
                    padding: 0;
                    margin: 20px 0;
                }
                .customer-item {
                    padding: 15px;
                    margin: 10px 0;
                    background: #f6f8fa;
                    border: 2px solid #d1d5da;
                    border-radius: 6px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .customer-item.current {
                    background: #e6ffed;
                    border-color: #28a745;
                }
                .customer-id {
                    font-family: monospace;
                    font-size: 18px;
                    font-weight: 600;
                }
                .badge {
                    background: #28a745;
                    color: white;
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                }
                code {
                    background: #f6f8fa;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 13px;
                }
                pre {
                    background: #24292e;
                    color: #e1e4e8;
                    padding: 15px;
                    border-radius: 6px;
                    overflow-x: auto;
                    font-size: 12px;
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
            <div class="container">
                <h1>📋 Accessible Google Ads Customers</h1>

                <div class="${result.success ? 'success' : 'error'}">
                    <strong>Status:</strong> ${result.success ? '✅ Success' : '❌ Failed'}<br>
                    ${result.error ? `<strong>Error:</strong> ${JSON.stringify(result.error)}<br>` : ''}
                </div>

                ${result.success && customerIds.length > 0 ? `
                    <h2>Found ${customerIds.length} accessible customer account(s):</h2>

                    <p style="color: #586069; font-size: 14px;">
                        Your currently configured customer ID: <code>${currentCustomerId}</code>
                    </p>

                    <ul class="customer-list">
                        ${customerIds.map(id => `
                            <li class="customer-item ${id === currentCustomerId ? 'current' : ''}">
                                <span class="customer-id">${id}</span>
                                ${id === currentCustomerId ? '<span class="badge">CURRENT</span>' : ''}
                            </li>
                        `).join('')}
                    </ul>

                    ${!customerIds.includes(currentCustomerId) ? `
                        <div class="error">
                            <strong>⚠️ Configuration Issue:</strong><br>
                            Your configured customer ID (<code>${currentCustomerId}</code>) is not in the list of accessible customers.<br>
                            <strong>Solution:</strong> Update your <code>GOOGLE_ADS_CUSTOMER_ID</code> environment variable to one of the IDs listed above.
                        </div>
                    ` : `
                        <div class="success">
                            ✅ Your configured customer ID matches an accessible account!
                        </div>
                    `}
                ` : result.success ? `
                    <div class="error">
                        <strong>No accessible customers found.</strong><br>
                        This could mean:
                        <ul>
                            <li>The OAuth account doesn't have access to any Google Ads accounts</li>
                            <li>The developer token hasn't been approved</li>
                            <li>You need to grant access to the OAuth user</li>
                        </ul>
                    </div>
                ` : ''}

                <h2>Next Steps</h2>
                ${!result.success || !customerIds.includes(currentCustomerId) ? `
                    <p>Fix the configuration issues above, then:</p>
                ` : ''}
                <a href="/.netlify/functions/google-ads-debug" class="btn">Run Debug</a>
                <a href="/.netlify/functions/google-ads-sync-test" class="btn">Test Sync</a>

                <details style="margin-top: 30px;">
                    <summary style="cursor: pointer; font-weight: 600;">Raw API Response</summary>
                    <pre>${JSON.stringify(result, null, 2)}</pre>
                </details>
            </div>
        </body>
        </html>
    `;
}
