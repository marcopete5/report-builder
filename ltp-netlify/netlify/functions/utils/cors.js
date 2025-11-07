// Shared CORS headers utility
// Configure allowed origin via CORS_ORIGIN environment variable

/**
 * Get CORS headers for API responses
 * @param {string} method - Optional specific HTTP method (defaults to common methods)
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(method) {
    const allowedOrigin = process.env.CORS_ORIGIN || '*';
    const allowedMethods = method || 'GET,POST,OPTIONS';

    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': allowedMethods,
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

module.exports = {
    getCorsHeaders
};
