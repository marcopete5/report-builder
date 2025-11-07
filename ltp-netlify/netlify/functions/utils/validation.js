// Input validation utilities

/**
 * Validate lesson entry submission data
 * @param {Object} data - Lesson entry data
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateLessonEntry(data) {
    const errors = [];

    // Required fields
    if (!data.studentName || typeof data.studentName !== 'string' || data.studentName.trim().length === 0) {
        errors.push('studentName is required and must be a non-empty string');
    }

    if (!data.studentId || typeof data.studentId !== 'string' || data.studentId.trim().length === 0) {
        errors.push('studentId is required and must be a non-empty string');
    }

    if (!data.lessonId || typeof data.lessonId !== 'string' || data.lessonId.trim().length === 0) {
        errors.push('lessonId is required and must be a non-empty string');
    }

    if (data.courseId !== undefined && data.courseId !== null && typeof data.courseId !== 'string') {
        errors.push('courseId must be a string if provided');
    }

    if (data.lessonTitle !== undefined && data.lessonTitle !== null && typeof data.lessonTitle !== 'string') {
        errors.push('lessonTitle must be a string if provided');
    }

    if (data.pageUrl !== undefined && data.pageUrl !== null) {
        if (typeof data.pageUrl !== 'string') {
            errors.push('pageUrl must be a string if provided');
        } else if (data.pageUrl.length > 2048) {
            errors.push('pageUrl must be less than 2048 characters');
        }
    }

    // Validate UTM object structure
    if (data.utm !== undefined && data.utm !== null) {
        if (typeof data.utm !== 'object' || Array.isArray(data.utm)) {
            errors.push('utm must be an object if provided');
        }
    }

    // Length limits
    if (data.studentName && data.studentName.length > 200) {
        errors.push('studentName must be less than 200 characters');
    }

    if (data.lessonId && data.lessonId.length > 100) {
        errors.push('lessonId must be less than 100 characters');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate date range
 * @param {string|Date} startDate - Start date
 * @param {string|Date} endDate - End date
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateDateRange(startDate, endDate) {
    const errors = [];

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) {
        errors.push('startDate is not a valid date');
    }

    if (isNaN(end.getTime())) {
        errors.push('endDate is not a valid date');
    }

    if (errors.length === 0 && start > end) {
        errors.push('startDate must be before or equal to endDate');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    validateLessonEntry,
    validateDateRange
};
