// Condition evaluators for notification rules
// Each evaluator checks if a specific condition is met for a student

const { calculatePace } = require('./pace-calculator');

/**
 * Evaluate a condition against a student
 * @param {string} conditionType - Type of condition to evaluate
 * @param {Object} params - Condition parameters
 * @param {Object} student - Student record
 * @param {Object} db - MongoDB database instance
 * @returns {Promise<Object>} { triggered: boolean, data: Object }
 */
async function evaluateCondition(conditionType, params, student, db) {
    const evaluator = conditionEvaluators[conditionType];

    if (!evaluator) {
        console.warn(`[Condition Evaluator] Unknown condition type: ${conditionType}`);
        return { triggered: false, data: { error: 'Unknown condition type' } };
    }

    try {
        return await evaluator(student, params, db);
    } catch (error) {
        console.error(`[Condition Evaluator] Error evaluating ${conditionType}:`, error);
        return { triggered: false, data: { error: error.message } };
    }
}

/**
 * Built-in condition evaluators
 */
const conditionEvaluators = {
    /**
     * Check if student has had no activity for X days
     */
    no_activity: async (student, params, db) => {
        const lessonEntriesColl = db.collection('lesson_entries');

        const lastEntry = await lessonEntriesColl
            .find({ studentId: student.studentId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray()
            .then(results => results[0] || null);

        if (!lastEntry) {
            // Student has never submitted anything
            return {
                triggered: false,
                data: {
                    reason: 'No submissions found',
                    daysInactive: null
                }
            };
        }

        const daysSince = (Date.now() - new Date(lastEntry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const triggered = daysSince >= params.days;

        // Format date as "Monday, November 24 2025"
        const formattedDate = new Date(lastEntry.createdAt).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        return {
            triggered,
            data: {
                daysInactive: Math.floor(daysSince),
                lastActivityDate: formattedDate,
                lastLesson: lastEntry.lessonTitle || lastEntry.lessonId || 'Unknown Lesson',
                lastLessonId: lastEntry.lessonId
            }
        };
    },

    /**
     * Check if student is behind their expected pace (using story points)
     */
    behind_pace: async (student, params, db) => {
        try {
            const lessonsColl = db.collection('lessons');
            const lessonEntriesColl = db.collection('lesson_entries');

            // Get all lessons for student's course
            const courseLessons = await lessonsColl.find({
                courseId: student.course
            }).toArray();

            if (courseLessons.length === 0) {
                return {
                    triggered: false,
                    data: { reason: 'No lessons found for course' }
                };
            }

            // Get student's lesson entries
            const studentEntries = await lessonEntriesColl
                .find({ studentId: student.studentId })
                .toArray();

            const submittedLessonIds = studentEntries.map(e => e.lessonId);

            // Use the story points-based pace calculator
            const { calculatePace } = require('./pace-calculator');
            const paceData = calculatePace({
                courseLessons,
                submittedLessonIds,
                courseStartDate: student.courseStartDate,
                courseEndDate: student.courseEndDate || student.courseExtDate
            });

            if (!paceData || !paceData.totalStoryPoints) {
                return {
                    triggered: false,
                    data: { reason: 'Cannot calculate pace (no start date or lessons)' }
                };
            }

            // Calculate story points behind
            const storyPointsBehind = Math.max(0, paceData.expectedStoryPoints - paceData.completedStoryPoints);

            // Calculate percentage behind
            let percentBehind = 0;
            if (paceData.expectedStoryPoints > 0) {
                percentBehind = ((paceData.expectedStoryPoints - paceData.completedStoryPoints) / paceData.expectedStoryPoints) * 100;
                percentBehind = Math.max(0, percentBehind); // Don't show negative (ahead)
            }

            // Threshold is percentage (default 10%)
            const threshold = params.percentThreshold || 10;
            const triggered = percentBehind >= threshold;

            return {
                triggered,
                data: {
                    percentBehind: Math.round(percentBehind * 10) / 10,
                    storyPointsBehind: Math.round(storyPointsBehind),
                    completedStoryPoints: paceData.completedStoryPoints,
                    expectedStoryPoints: Math.round(paceData.expectedStoryPoints),
                    totalStoryPoints: paceData.totalStoryPoints,
                    daysRemaining: paceData.daysRemaining,
                    paceStatus: paceData.paceStatus
                }
            };
        } catch (error) {
            console.error('[Condition Evaluator] Error in behind_pace:', error);
            return {
                triggered: false,
                data: { error: error.message }
            };
        }
    },

    /**
     * Check if student has reached a specific milestone (started mid-level, end-level, etc.)
     */
    milestone_reached: async (student, params, db) => {
        const lessonEntriesColl = db.collection('lesson_entries');

        // Check for recent lesson entries matching milestone criteria
        const hoursWindow = params.hours_window || 24; // Default to last 24 hours
        const sinceDate = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);

        const query = {
            studentId: student.studentId,
            createdAt: { $gte: sinceDate }
        };

        // Add lesson ID filter if specified
        if (params.milestone_lesson_ids && params.milestone_lesson_ids.length > 0) {
            query.lessonId = { $in: params.milestone_lesson_ids };
        }

        // Add lesson title pattern if specified
        if (params.lesson_title_pattern) {
            query.lessonTitle = { $regex: params.lesson_title_pattern, $options: 'i' };
        }

        const recentEntry = await lessonEntriesColl
            .findOne(query)
            .sort({ createdAt: -1 });

        const triggered = !!recentEntry;

        return {
            triggered,
            data: {
                milestone: params.milestone_name || 'Unknown milestone',
                lessonTitle: recentEntry?.lessonTitle,
                lessonId: recentEntry?.lessonId,
                level: recentEntry?.level,
                submittedAt: recentEntry?.createdAt
            }
        };
    },

    /**
     * Check if student is approaching their course end deadline
     */
    approaching_deadline: async (student, params, db) => {
        const endDate = student.courseExtDate || student.courseEndDate;

        if (!endDate) {
            return {
                triggered: false,
                data: { reason: 'No end date set for student' }
            };
        }

        const daysUntil = (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        const threshold = params.days || 30; // Default to 30 days
        const triggered = daysUntil <= threshold && daysUntil > 0;

        return {
            triggered,
            data: {
                daysRemaining: Math.floor(daysUntil),
                endDate: endDate,
                courseExtDate: student.courseExtDate,
                courseEndDate: student.courseEndDate
            }
        };
    },

    /**
     * Check if student has low activity (less than X submissions in Y days)
     */
    low_activity: async (student, params, db) => {
        const lessonEntriesColl = db.collection('lesson_entries');

        const days = params.days || 7;
        const minSubmissions = params.min_submissions || 3;
        const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const recentEntries = await lessonEntriesColl
            .find({
                studentId: student.studentId,
                createdAt: { $gte: sinceDate }
            })
            .toArray();

        const submissionCount = recentEntries.length;
        const triggered = submissionCount < minSubmissions;

        return {
            triggered,
            data: {
                days,
                submissionCount,
                minSubmissions,
                averagePerDay: (submissionCount / days).toFixed(2)
            }
        };
    }
};

/**
 * Get list of available condition types
 * @returns {Array<Object>} Array of condition type definitions
 */
function getAvailableConditions() {
    return [
        {
            type: 'no_activity',
            name: 'No Activity',
            description: 'Triggers when student has not submitted any lessons for X days',
            params: {
                days: { type: 'number', required: true, description: 'Number of days without activity' }
            }
        },
        {
            type: 'behind_pace',
            name: 'Behind Pace',
            description: 'Triggers when student is X% behind expected pace (shows as "X% Behind (Y Story Points)")',
            params: {
                percentThreshold: { type: 'number', required: true, description: 'Percentage behind pace to trigger (e.g., 10 for 10%)' }
            }
        },
        {
            type: 'milestone_reached',
            name: 'Milestone Reached',
            description: 'Triggers when student completes a specific milestone lesson',
            params: {
                milestone_name: { type: 'string', required: true, description: 'Name of the milestone' },
                milestone_lesson_ids: { type: 'array', required: false, description: 'Array of lesson IDs' },
                lesson_title_pattern: { type: 'string', required: false, description: 'Regex pattern for lesson title' },
                hours_window: { type: 'number', required: false, description: 'Check last X hours (default 24)' }
            }
        },
        {
            type: 'approaching_deadline',
            name: 'Approaching Deadline',
            description: 'Triggers when student is X days away from course end date',
            params: {
                days: { type: 'number', required: true, description: 'Days before deadline to trigger' }
            }
        },
        {
            type: 'low_activity',
            name: 'Low Activity',
            description: 'Triggers when student has fewer than X submissions in Y days',
            params: {
                days: { type: 'number', required: true, description: 'Number of days to check' },
                min_submissions: { type: 'number', required: true, description: 'Minimum submissions expected' }
            }
        }
    ];
}

module.exports = {
    evaluateCondition,
    getAvailableConditions
};
