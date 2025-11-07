// /.netlify/functions/google-ads-oauth-callback
// Handles OAuth callback and exchanges code for tokens

const https = require('https');
const { getConfig } = require('./utils/google-ads-client');
const { getCorsHeaders } = require('./utils/cors');

/**
 * Exchange authorization code for tokens
 */
function exchangeCodeForTokens(code, redirectUri, config) {
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            code: code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
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
                    if (result.error) {
                        reject(new Error(result.error_description || result.error));
                    } else {
                        resolve(result);
                    }
                } catch (err) {
                    reject(new Error('Failed to parse token response: ' + err.message));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error('Token exchange request failed: ' + err.message));
        });

        req.write(postData);
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

    try {
        const q = event.queryStringParameters || {};
        const code = q.code;
        const error = q.error;

        if (error) {
            return {
                statusCode: 400,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/html'
                },
                body: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>OAuth Error</title>
                        <style>
                            body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                            .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 5px; }
                            h1 { color: #c00; }
                        </style>
                    </head>
                    <body>
                        <div class="error">
                            <h1>OAuth Authorization Failed</h1>
                            <p><strong>Error:</strong> ${error}</p>
                            <p>Please try again or contact support if the problem persists.</p>
                        </div>
                    </body>
                    </html>
                `
            };
        }

        if (!code) {
            return {
                statusCode: 400,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Missing authorization code'
                })
            };
        }

        const config = getConfig();

        // Build the callback URL (must match what we used in init)
        const protocol = event.headers['x-forwarded-proto'] || 'https';
        const host = event.headers.host;
        const redirectUri = `${protocol}://${host}/.netlify/functions/google-ads-oauth-callback`;

        // Exchange code for tokens
        const tokens = await exchangeCodeForTokens(code, redirectUri, config);

        // Display the refresh token to the user
        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/html'
            },
            body: `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Google Ads OAuth Success</title>
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
                        .token-box {
                            background: #f6f8fa;
                            border: 1px solid #d1d5da;
                            border-radius: 6px;
                            padding: 15px;
                            margin: 20px 0;
                            word-break: break-all;
                            font-family: monospace;
                            font-size: 14px;
                        }
                        .copy-btn {
                            background: #2ea44f;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 14px;
                            font-weight: 600;
                        }
                        .copy-btn:hover {
                            background: #2c974b;
                        }
                        .instructions {
                            background: #fff3cd;
                            border: 1px solid #ffc107;
                            border-radius: 6px;
                            padding: 15px;
                            margin-top: 20px;
                        }
                        .instructions h3 {
                            color: #856404;
                            margin-top: 0;
                        }
                        .instructions ol {
                            margin: 10px 0;
                            padding-left: 20px;
                        }
                        .instructions li {
                            margin: 8px 0;
                        }
                        code {
                            background: #f6f8fa;
                            padding: 2px 6px;
                            border-radius: 3px;
                            font-size: 13px;
                        }
                    </style>
                </head>
                <body>
                    <div class="success">
                        <h1>✓ OAuth Authorization Successful!</h1>
                        <p>Your refresh token has been generated. Copy it and add it to your environment variables.</p>

                        <h3>Refresh Token:</h3>
                        <div class="token-box" id="refresh-token">${tokens.refresh_token}</div>
                        <button class="copy-btn" onclick="copyToken()">Copy Refresh Token</button>

                        <div class="instructions">
                            <h3>Next Steps:</h3>
                            <ol>
                                <li>Copy the refresh token above</li>
                                <li>Go to your Netlify site dashboard</li>
                                <li>Navigate to <strong>Site settings → Environment variables</strong></li>
                                <li>Add a new variable:
                                    <ul>
                                        <li>Key: <code>GOOGLE_ADS_REFRESH_TOKEN</code></li>
                                        <li>Value: (paste the refresh token)</li>
                                    </ul>
                                </li>
                                <li>Deploy your site or trigger a rebuild</li>
                                <li>Test the connection at: <code>/.netlify/functions/google-ads-sync-test</code></li>
                            </ol>
                        </div>
                    </div>

                    <script>
                        function copyToken() {
                            const tokenText = document.getElementById('refresh-token').textContent;
                            navigator.clipboard.writeText(tokenText).then(() => {
                                const btn = document.querySelector('.copy-btn');
                                const originalText = btn.textContent;
                                btn.textContent = '✓ Copied!';
                                btn.style.background = '#2c974b';
                                setTimeout(() => {
                                    btn.textContent = originalText;
                                    btn.style.background = '#2ea44f';
                                }, 2000);
                            });
                        }
                    </script>
                </body>
                </html>
            `
        };
    } catch (err) {
        console.error('OAuth callback error:', err);
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
                    <title>OAuth Error</title>
                    <style>
                        body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                        .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 5px; }
                        h1 { color: #c00; }
                        pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
                    </style>
                </head>
                <body>
                    <div class="error">
                        <h1>OAuth Token Exchange Failed</h1>
                        <p><strong>Error:</strong> ${err.message}</p>
                        <pre>${err.stack || ''}</pre>
                        <p>Please try the OAuth flow again or contact support.</p>
                    </div>
                </body>
                </html>
            `
        };
    }
};
