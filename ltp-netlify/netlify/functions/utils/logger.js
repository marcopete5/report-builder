// Centralized logging utility with environment-based control

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// Get log level from environment (defaults to INFO in production, DEBUG in development)
function getLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
        return LOG_LEVELS[envLevel];
    }
    // Default: INFO in production, DEBUG in development
    return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
}

const currentLogLevel = getLogLevel();

/**
 * Log error message
 * @param {string} context - Context/function name (e.g., '[lesson-entry]')
 * @param {string} message - Log message
 * @param  {...any} args - Additional arguments
 */
function error(context, message, ...args) {
    if (currentLogLevel >= LOG_LEVELS.ERROR) {
        console.error(`${context} ERROR:`, message, ...args);
    }
}

/**
 * Log warning message
 * @param {string} context - Context/function name
 * @param {string} message - Log message
 * @param  {...any} args - Additional arguments
 */
function warn(context, message, ...args) {
    if (currentLogLevel >= LOG_LEVELS.WARN) {
        console.warn(`${context} WARN:`, message, ...args);
    }
}

/**
 * Log info message
 * @param {string} context - Context/function name
 * @param {string} message - Log message
 * @param  {...any} args - Additional arguments
 */
function info(context, message, ...args) {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
        console.log(`${context} INFO:`, message, ...args);
    }
}

/**
 * Log debug message
 * @param {string} context - Context/function name
 * @param {string} message - Log message
 * @param  {...any} args - Additional arguments
 */
function debug(context, message, ...args) {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
        console.log(`${context} DEBUG:`, message, ...args);
    }
}

module.exports = {
    error,
    warn,
    info,
    debug,
    LOG_LEVELS
};
