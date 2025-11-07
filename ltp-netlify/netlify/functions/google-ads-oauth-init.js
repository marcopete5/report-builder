// /.netlify/functions/google-ads-oauth-init
// Initiates OAuth flow for Google Ads API

const { getConfig } = require('./utils/google-ads-client');
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
                    error: 'Missing Google Ads OAuth credentials. Please set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET environment variables.'
                })
            };
        }

        // Build the callback URL
        const protocol = event.headers['x-forwarded-proto'] || 'https';
        const host = event.headers.host;
        const redirectUri = `${protocol}://${host}/.netlify/functions/google-ads-oauth-callback`;

        // Build OAuth authorization URL
        const authParams = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: redirectUri,
            scope: 'https://www.googleapis.com/auth/adwords',
            response_type: 'code',
            access_type: 'offline', // Important: This allows us to get a refresh token
            prompt: 'consent' // Force consent screen to ensure we get a refresh token
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;

        // Redirect to Google OAuth
        return {
            statusCode: 302,
            headers: {
                ...corsHeaders,
                'Location': authUrl
            },
            body: ''
        };
    } catch (err) {
        console.error('OAuth init error:', err);
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
