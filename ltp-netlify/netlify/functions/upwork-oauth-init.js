// /.netlify/functions/upwork-oauth-init
// Initiates OAuth2 Authorization Code flow for Upwork API

const { getConfig, UPWORK_AUTH_URL } = require('./utils/upwork-client');
const { requireAdmin } = require('./utils/db-auth');
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

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const config = getConfig();

        if (!config.clientId || !config.clientSecret) {
            return {
                statusCode: 500,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Missing Upwork OAuth credentials. Please set UPWORK_CLIENT_ID and UPWORK_CLIENT_SECRET environment variables.'
                })
            };
        }

        if (!config.encryptionKey) {
            return {
                statusCode: 500,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Missing UPWORK_TOKEN_ENCRYPTION_KEY environment variable. Generate a 64-character hex string.'
                })
            };
        }

        // Build the callback URL
        const protocol = event.headers['x-forwarded-proto'] || 'https';
        const host = event.headers.host;
        const redirectUri = config.redirectUri || `${protocol}://${host}/.netlify/functions/upwork-oauth-callback`;

        // Generate state parameter for CSRF protection
        const state = require('crypto').randomBytes(16).toString('hex');

        // Upwork OAuth2 scopes
        // - Common Entities Read-Only
        // - Read marketplace Job Postings
        // - Ontology Read-Only
        const scopes = [
            'entities:read',
            'marketplace:jobs:read',
            'ontology:read'
        ].join(' ');

        // Build OAuth authorization URL
        const authParams = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: scopes,
            state: state
        });

        const authUrl = `${UPWORK_AUTH_URL}?${authParams.toString()}`;

        console.log('[Upwork OAuth] Initiating authorization flow');
        console.log('[Upwork OAuth] Redirect URI:', redirectUri);
        console.log('[Upwork OAuth] Scopes:', scopes);

        // Redirect to Upwork OAuth
        return {
            statusCode: 302,
            headers: {
                ...corsHeaders,
                'Location': authUrl,
                'Set-Cookie': `upwork_oauth_state=${state}; HttpOnly; Secure; SameSite=Strict; Max-Age=600; Path=/`
            },
            body: ''
        };
    } catch (err) {
        console.error('[Upwork OAuth] Init error:', err);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: err.message
            })
        };
    }
};
