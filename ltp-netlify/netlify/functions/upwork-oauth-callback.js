// /.netlify/functions/upwork-oauth-callback
// Handles OAuth2 callback from Upwork and stores encrypted tokens

const {
    exchangeCodeForTokens,
    storeTokens,
    createUpworkIndexes,
    getConfig
} = require('./utils/upwork-client');
const { getCorsHeaders } = require('./utils/cors');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        const q = event.queryStringParameters || {};
        const code = q.code;
        const error = q.error;
        const errorDescription = q.error_description;
        const state = q.state;

        // Handle OAuth error
        if (error) {
            console.error('[Upwork OAuth] Authorization error:', error, errorDescription);
            return {
                statusCode: 400,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/html'
                },
                body: renderErrorPage(error, errorDescription)
            };
        }

        // Validate authorization code
        if (!code) {
            return {
                statusCode: 400,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/html'
                },
                body: renderErrorPage('missing_code', 'No authorization code received from Upwork')
            };
        }

        // Validate encryption key is configured
        const config = getConfig();
        if (!config.encryptionKey || config.encryptionKey.length !== 64) {
            return {
                statusCode: 500,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/html'
                },
                body: renderErrorPage('config_error', 'UPWORK_TOKEN_ENCRYPTION_KEY is not properly configured. It must be a 64-character hex string.')
            };
        }

        console.log('[Upwork OAuth] Exchanging code for tokens...');

        // Exchange authorization code for tokens
        const tokens = await exchangeCodeForTokens(code);

        if (!tokens.access_token || !tokens.refresh_token) {
            throw new Error('Invalid token response from Upwork');
        }

        console.log('[Upwork OAuth] Token exchange successful');
        console.log('[Upwork OAuth] Scopes:', tokens.scope);
        console.log('[Upwork OAuth] Expires in:', tokens.expires_in, 'seconds');

        // Create database indexes
        await createUpworkIndexes();

        // Store encrypted tokens in MongoDB
        await storeTokens(tokens);

        console.log('[Upwork OAuth] Tokens stored successfully');

        // Return success page
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html',
                'Set-Cookie': 'upwork_oauth_state=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/'
            },
            body: renderSuccessPage(tokens)
        };
    } catch (err) {
        console.error('[Upwork OAuth] Callback error:', err);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: renderErrorPage('exchange_failed', err.message)
        };
    }
};

/**
 * Render success page HTML
 */
function renderSuccessPage(tokens) {
    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));
    const scopes = tokens.scope ? tokens.scope.split(' ') : [];

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Upwork OAuth Success</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 800px;
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
                h1 {
                    color: #28a745;
                    margin-bottom: 20px;
                }
                .info-box {
                    background: #f6f8fa;
                    border: 1px solid #d1d5da;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 20px 0;
                }
                .info-box h3 {
                    margin-top: 0;
                    color: #24292e;
                }
                .scope-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 10px;
                }
                .scope-badge {
                    background: #e1e4e8;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 13px;
                    font-family: monospace;
                }
                .next-steps {
                    background: #d4edda;
                    border: 1px solid #c3e6cb;
                    border-radius: 6px;
                    padding: 15px;
                    margin-top: 20px;
                }
                .next-steps h3 {
                    color: #155724;
                    margin-top: 0;
                }
                .next-steps ul {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                .next-steps li {
                    margin: 8px 0;
                }
                code {
                    background: #f6f8fa;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 13px;
                }
                .btn {
                    display: inline-block;
                    background: #2ea44f;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 600;
                    margin-top: 15px;
                }
                .btn:hover {
                    background: #2c974b;
                }
            </style>
        </head>
        <body>
            <div class="success">
                <h1>Upwork OAuth Authorization Successful!</h1>
                <p>Your Upwork API credentials have been securely stored and encrypted in the database.</p>

                <div class="info-box">
                    <h3>Token Details</h3>
                    <p><strong>Expires:</strong> ${expiresAt.toLocaleString()}</p>
                    <p><strong>Scopes Granted:</strong></p>
                    <div class="scope-list">
                        ${scopes.map(s => `<span class="scope-badge">${s}</span>`).join('')}
                    </div>
                </div>

                <div class="next-steps">
                    <h3>What's Next?</h3>
                    <ul>
                        <li>Tokens are automatically refreshed when they expire</li>
                        <li>The daily job sync will run automatically at 5 AM UTC</li>
                        <li>You can manually trigger a sync at <code>/api/upwork-jobs-sync-manual</code></li>
                        <li>View job insights at <code>/dashboard-upwork.html</code></li>
                    </ul>
                </div>

                <a href="/dashboards.html" class="btn">Go to Dashboards</a>
            </div>
        </body>
        </html>
    `;
}

/**
 * Render error page HTML
 */
function renderErrorPage(error, description) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Upwork OAuth Error</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 600px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f7fa;
                }
                .error {
                    background: white;
                    border: 1px solid #f5c6cb;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 {
                    color: #dc3545;
                    margin-bottom: 20px;
                }
                .error-details {
                    background: #f8d7da;
                    border: 1px solid #f5c6cb;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 20px 0;
                }
                .error-code {
                    font-family: monospace;
                    background: #f6f8fa;
                    padding: 2px 6px;
                    border-radius: 3px;
                }
                .btn {
                    display: inline-block;
                    background: #6c757d;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 600;
                    margin-top: 15px;
                }
                .btn:hover {
                    background: #5a6268;
                }
            </style>
        </head>
        <body>
            <div class="error">
                <h1>OAuth Authorization Failed</h1>
                <div class="error-details">
                    <p><strong>Error:</strong> <span class="error-code">${error}</span></p>
                    <p><strong>Description:</strong> ${description || 'No additional details available'}</p>
                </div>
                <p>Please try the authorization flow again. If the problem persists, check your Upwork OAuth application settings.</p>
                <a href="/api/upwork-oauth-init" class="btn">Try Again</a>
            </div>
        </body>
        </html>
    `;
}
