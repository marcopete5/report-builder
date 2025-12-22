// /.netlify/functions/utils/upwork-client.js
// Upwork API client utility with OAuth2 token management and GraphQL execution

const https = require('https');
const crypto = require('crypto');
const { getDb } = require('./database');

// Upwork API endpoints
const UPWORK_AUTH_URL = 'https://www.upwork.com/ab/account-security/oauth2/authorize';
const UPWORK_TOKEN_URL = 'https://www.upwork.com/api/v3/oauth2/token';
const UPWORK_GRAPHQL_URL = 'https://www.upwork.com/api/graphql';

// Rate limiting: 300 requests per minute
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60000;
let requestTimestamps = [];

// Encryption algorithm for token storage
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get Upwork configuration from environment variables
 */
function getConfig() {
    return {
        clientId: process.env.UPWORK_CLIENT_ID,
        clientSecret: process.env.UPWORK_CLIENT_SECRET,
        redirectUri: process.env.UPWORK_REDIRECT_URI || 'https://vschool-reports.netlify.app/api/upwork-oauth-callback',
        encryptionKey: process.env.UPWORK_TOKEN_ENCRYPTION_KEY
    };
}

/**
 * Encrypt a string using AES-256-GCM
 */
function encrypt(text, key) {
    if (!key || key.length !== 64) {
        throw new Error('Encryption key must be a 64-character hex string');
    }

    const keyBuffer = Buffer.from(key, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with AES-256-GCM
 */
function decrypt(encryptedText, key) {
    if (!key || key.length !== 64) {
        throw new Error('Encryption key must be a 64-character hex string');
    }

    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted text format');
    }

    const keyBuffer = Buffer.from(key, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Check rate limit before making a request
 */
function checkRateLimit() {
    const now = Date.now();
    // Remove timestamps older than the rate window
    requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_WINDOW_MS);

    if (requestTimestamps.length >= RATE_LIMIT) {
        const oldestRequest = requestTimestamps[0];
        const waitTime = RATE_WINDOW_MS - (now - oldestRequest);
        return { allowed: false, waitTime };
    }

    requestTimestamps.push(now);
    return { allowed: true, waitTime: 0 };
}

/**
 * Wait for rate limit to clear
 */
async function waitForRateLimit() {
    const check = checkRateLimit();
    if (!check.allowed) {
        console.log(`[Upwork] Rate limit reached, waiting ${check.waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, check.waitTime + 100));
        return waitForRateLimit();
    }
    return true;
}

/**
 * Make an HTTPS request
 */
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (res.statusCode >= 400) {
                        const error = new Error(result.error_description || result.error || `HTTP ${res.statusCode}`);
                        error.statusCode = res.statusCode;
                        error.response = result;
                        reject(error);
                    } else {
                        resolve(result);
                    }
                } catch (err) {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    } else {
                        resolve(data);
                    }
                }
            });
        });

        req.on('error', reject);

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code) {
    const config = getConfig();

    const postData = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri
    }).toString();

    const options = {
        hostname: 'www.upwork.com',
        path: '/api/v3/oauth2/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return httpsRequest(options, postData);
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(refreshToken) {
    const config = getConfig();

    const postData = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret
    }).toString();

    const options = {
        hostname: 'www.upwork.com',
        path: '/api/v3/oauth2/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return httpsRequest(options, postData);
}

/**
 * Store tokens in MongoDB (encrypted)
 */
async function storeTokens(tokens) {
    const config = getConfig();
    const db = await getDb();

    const encryptedAccessToken = encrypt(tokens.access_token, config.encryptionKey);
    const encryptedRefreshToken = encrypt(tokens.refresh_token, config.encryptionKey);

    const tokenDoc = {
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: new Date(Date.now() + (tokens.expires_in * 1000)),
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        updated_at: new Date(),
        last_refresh: new Date(),
        is_active: true
    };

    // Upsert - only keep one active token record
    await db.collection('upwork_tokens').updateOne(
        { is_active: true },
        {
            $set: tokenDoc,
            $setOnInsert: { created_at: new Date() }
        },
        { upsert: true }
    );

    console.log('[Upwork] Tokens stored successfully');
    return tokenDoc;
}

/**
 * Get active tokens from MongoDB (decrypted)
 */
async function getActiveTokens() {
    const config = getConfig();
    const db = await getDb();

    const tokenDoc = await db.collection('upwork_tokens').findOne({ is_active: true });

    if (!tokenDoc) {
        return null;
    }

    try {
        return {
            access_token: decrypt(tokenDoc.access_token, config.encryptionKey),
            refresh_token: decrypt(tokenDoc.refresh_token, config.encryptionKey),
            expires_at: tokenDoc.expires_at,
            scopes: tokenDoc.scopes,
            last_refresh: tokenDoc.last_refresh
        };
    } catch (err) {
        console.error('[Upwork] Failed to decrypt tokens:', err.message);
        return null;
    }
}

/**
 * Get valid access token, refreshing if necessary
 */
async function getValidAccessToken() {
    const tokens = await getActiveTokens();

    if (!tokens) {
        throw new Error('No active Upwork tokens found. Please complete OAuth authorization.');
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresIn = tokens.expires_at.getTime() - Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (expiresIn < FIVE_MINUTES) {
        console.log('[Upwork] Access token expired or expiring soon, refreshing...');

        try {
            const newTokens = await refreshAccessToken(tokens.refresh_token);
            await storeTokens(newTokens);
            return newTokens.access_token;
        } catch (err) {
            console.error('[Upwork] Token refresh failed:', err.message);
            throw new Error('Token refresh failed. Please re-authorize.');
        }
    }

    return tokens.access_token;
}

/**
 * Execute a GraphQL query against Upwork API
 */
async function executeGraphQL(query, variables = {}, tenantId = null) {
    await waitForRateLimit();

    const accessToken = await getValidAccessToken();
    const startTime = Date.now();

    const postData = JSON.stringify({ query, variables });

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(postData)
    };

    // Add tenant ID header if provided (for org-specific queries)
    if (tenantId) {
        headers['X-Upwork-API-TenantId'] = tenantId;
    }

    const options = {
        hostname: 'www.upwork.com',
        path: '/api/graphql',
        method: 'POST',
        headers
    };

    try {
        const result = await httpsRequest(options, postData);
        const duration = Date.now() - startTime;

        console.log(`[Upwork] GraphQL query completed in ${duration}ms`);

        if (result.errors && result.errors.length > 0) {
            console.error('[Upwork] GraphQL errors:', JSON.stringify(result.errors));
            throw new Error(result.errors[0].message);
        }

        return result.data;
    } catch (err) {
        const duration = Date.now() - startTime;
        console.error(`[Upwork] GraphQL query failed after ${duration}ms:`, err.message);
        throw err;
    }
}

/**
 * Search for job postings with keyword filters
 */
async function searchJobPostings(searchQuery, first = 50, after = null) {
    const query = `
        query SearchJobs($searchQuery: String!, $first: Int, $after: String) {
            marketplaceJobPostingsSearch(
                searchQuery: $searchQuery
                first: $first
                after: $after
            ) {
                totalCount
                pageInfo {
                    hasNextPage
                    endCursor
                }
                edges {
                    cursor
                    node {
                        id
                        title
                        publishedDateTime
                        jobType
                        budget {
                            amount
                            currencyCode
                        }
                        hourlyBudget {
                            min
                            max
                            currencyCode
                        }
                        contractorTier
                        client {
                            location {
                                country
                            }
                        }
                        category {
                            id
                            name
                            parentCategory {
                                id
                                name
                            }
                        }
                        skills {
                            id
                            name
                        }
                    }
                }
            }
        }
    `;

    return executeGraphQL(query, { searchQuery, first, after });
}

/**
 * Get job posting content/description
 */
async function getJobPostingContent(jobIds) {
    const query = `
        query GetJobContents($ids: [ID!]!) {
            marketplaceJobPostingsContents(ids: $ids) {
                id
                description
            }
        }
    `;

    return executeGraphQL(query, { ids: jobIds });
}

/**
 * Check token expiry and return status
 */
async function getTokenStatus() {
    const tokens = await getActiveTokens();

    if (!tokens) {
        return { status: 'missing', message: 'No tokens found' };
    }

    const expiresIn = tokens.expires_at.getTime() - Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (expiresIn < 0) {
        return {
            status: 'expired',
            message: 'Token expired',
            expires_at: tokens.expires_at,
            last_refresh: tokens.last_refresh
        };
    }

    if (expiresIn < ONE_DAY) {
        return {
            status: 'expiring_soon',
            message: 'Token expiring within 24 hours',
            expires_at: tokens.expires_at,
            expires_in_hours: Math.floor(expiresIn / (60 * 60 * 1000)),
            last_refresh: tokens.last_refresh
        };
    }

    return {
        status: 'valid',
        message: 'Token valid',
        expires_at: tokens.expires_at,
        expires_in_hours: Math.floor(expiresIn / (60 * 60 * 1000)),
        last_refresh: tokens.last_refresh
    };
}

/**
 * Create database indexes for Upwork collections
 */
async function createUpworkIndexes() {
    const db = await getDb();

    // upwork_tokens indexes
    await db.collection('upwork_tokens').createIndex(
        { is_active: 1 },
        { background: true }
    );

    // upwork_jobs_raw indexes
    await db.collection('upwork_jobs_raw').createIndex(
        { upwork_id: 1 },
        { unique: true, background: true }
    );
    await db.collection('upwork_jobs_raw').createIndex(
        { published_at: -1 },
        { background: true }
    );
    await db.collection('upwork_jobs_raw').createIndex(
        { niche: 1 },
        { background: true }
    );
    await db.collection('upwork_jobs_raw').createIndex(
        { fetched_at: -1 },
        { background: true }
    );
    await db.collection('upwork_jobs_raw').createIndex(
        { niche: 1, published_at: -1 },
        { background: true }
    );

    // upwork_aggregates_daily indexes
    await db.collection('upwork_aggregates_daily').createIndex(
        { date: -1 },
        { background: true }
    );
    await db.collection('upwork_aggregates_daily').createIndex(
        { niche: 1 },
        { background: true }
    );
    await db.collection('upwork_aggregates_daily').createIndex(
        { date: 1, niche: 1 },
        { unique: true, background: true }
    );

    // upwork_aggregates_weekly indexes
    await db.collection('upwork_aggregates_weekly').createIndex(
        { week_start: -1 },
        { background: true }
    );
    await db.collection('upwork_aggregates_weekly').createIndex(
        { week_start: 1, niche: 1 },
        { unique: true, background: true }
    );

    // upwork_sync_state for cursor tracking
    await db.collection('upwork_sync_state').createIndex(
        { niche: 1 },
        { unique: true, background: true }
    );

    console.log('[Upwork] Database indexes created');
}

/**
 * Niche filter configuration
 */
const NICHE_FILTERS = {
    automation: {
        include: [
            'n8n', 'make.com', 'zapier', 'airtable', 'playwright',
            'selenium', 'supabase', 'integromat', 'automate', 'workflow',
            'automation', 'api integration', 'webhook', 'scraping',
            'puppeteer', 'cypress'
        ],
        exclude: [
            'logo', 'translation', 'cv writing', 'data entry',
            'virtual assistant', 'typing', 'transcription', 'resume'
        ]
    },
    webdev: {
        include: [
            'react', 'vue', 'nextjs', 'nodejs', 'typescript',
            'tailwind', 'javascript', 'frontend', 'backend', 'fullstack',
            'full stack', 'web application', 'web app', 'api development',
            'rest api', 'graphql', 'express', 'nestjs', 'svelte', 'angular'
        ],
        exclude: [
            'wordpress theme', 'shopify theme', 'logo', 'graphic design',
            'wix', 'squarespace', 'banner design', 'flyer'
        ]
    },
    cybersecurity: {
        include: [
            'penetration testing', 'pentest', 'security audit', 'vulnerability',
            'owasp', 'burp suite', 'nmap', 'metasploit', 'soc', 'siem',
            'incident response', 'malware analysis', 'threat hunting',
            'security assessment', 'ethical hacking', 'bug bounty',
            'security engineer', 'infosec', 'cybersecurity', 'cyber security',
            'network security', 'application security', 'appsec'
        ],
        exclude: [
            'antivirus installation', 'password reset', 'tech support',
            'computer repair', 'virus removal'
        ]
    }
};

/**
 * Check if text matches a niche's filters
 */
function matchesNicheFilters(text, niche) {
    const filters = NICHE_FILTERS[niche];
    if (!filters) return { matches: false, keywords: [] };

    const lowerText = text.toLowerCase();

    // Check exclude list first
    for (const excludeWord of filters.exclude) {
        if (lowerText.includes(excludeWord.toLowerCase())) {
            return { matches: false, keywords: [] };
        }
    }

    // Check include list
    const matchedKeywords = [];
    for (const includeWord of filters.include) {
        if (lowerText.includes(includeWord.toLowerCase())) {
            matchedKeywords.push(includeWord);
        }
    }

    return {
        matches: matchedKeywords.length > 0,
        keywords: matchedKeywords
    };
}

module.exports = {
    getConfig,
    encrypt,
    decrypt,
    exchangeCodeForTokens,
    refreshAccessToken,
    storeTokens,
    getActiveTokens,
    getValidAccessToken,
    executeGraphQL,
    searchJobPostings,
    getJobPostingContent,
    getTokenStatus,
    createUpworkIndexes,
    NICHE_FILTERS,
    matchesNicheFilters,
    checkRateLimit,
    waitForRateLimit,
    UPWORK_AUTH_URL,
    UPWORK_TOKEN_URL,
    UPWORK_GRAPHQL_URL
};
