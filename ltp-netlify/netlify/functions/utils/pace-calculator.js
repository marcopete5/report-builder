// Shared pace calculation utility

/**
 * Calculate pace metrics for a student
 * @param {Object} params - Calculation parameters
 * @param {Array} params.courseLessons - All lessons in the course
 * @param {Array} params.submittedLessonIds - Array of lessonIds the student has submitted
 * @param {string} params.courseStartDate - Course start date (ISO string)
 * @param {string} params.courseEndDate - Course end date (ISO string)
 * @returns {Object} Pace calculation results
 */
function calculatePace({ courseLessons, submittedLessonIds, courseStartDate, courseEndDate }) {
    // Sort lessons by curriculum order
    const sortedLessons = courseLessons.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        if (a.sectionOrder !== b.sectionOrder) return a.sectionOrder - b.sectionOrder;
        return a.lessonOrder - b.lessonOrder;
    });

    // Assign curriculum index
    sortedLessons.forEach((lesson, index) => {
        lesson.curriculumIndex = index;
    });

    // Calculate total story points
    const totalStoryPoints = sortedLessons.reduce((sum, lesson) => {
        return sum + parseInt(lesson.storyPoints || 0, 10);
    }, 0);

    // Find completed lessons (actual submissions)
    const completedLessons = sortedLessons.filter(lesson =>
        submittedLessonIds.includes(lesson.lessonId)
    );

    // Find furthest curriculum index from any submission
    let furthestCurriculumIndex = -1;
    if (completedLessons.length > 0) {
        furthestCurriculumIndex = Math.max(...completedLessons.map(l => l.curriculumIndex || 0));
    }

    // Calculate story points based on curriculum progress (all lessons up to furthest index)
    // This counts all lessons from 0 to furthestCurriculumIndex, even if not submitted
    const completedStoryPoints = sortedLessons
        .filter(lesson => lesson.curriculumIndex <= furthestCurriculumIndex)
        .reduce((sum, lesson) => {
            return sum + parseInt(lesson.storyPoints || 0, 10);
        }, 0);

    // Calculate remaining story points from furthest curriculum index forward
    const remainingLessons = sortedLessons.filter(lesson =>
        lesson.curriculumIndex > furthestCurriculumIndex
    );
    const remainingStoryPoints = remainingLessons.reduce((sum, lesson) => {
        return sum + parseInt(lesson.storyPoints || 0, 10);
    }, 0);

    // Date calculations
    const startDate = new Date(courseStartDate);
    const endDate = new Date(courseEndDate);
    const today = new Date();

    const totalCourseDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const daysElapsed = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
    const daysRemainingRaw = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    const daysRemaining = daysRemainingRaw < 0 ? 0 : daysRemainingRaw;
    const isPastEndDate = today > endDate;

    // Calculate required daily pace (from current position forward)
    const requiredDailyPace = daysRemaining > 0 && remainingStoryPoints > 0
        ? remainingStoryPoints / daysRemaining
        : 0;

    // Calculate actual pace
    const actualDailyPace = daysElapsed > 0 ? completedStoryPoints / daysElapsed : 0;

    // Calculate expected pace (original)
    const originalRequiredPace = totalCourseDays > 0 ? totalStoryPoints / totalCourseDays : 0;
    const expectedStoryPoints = originalRequiredPace * daysElapsed;

    // Determine pace status (5% tolerance)
    let paceStatus = 'on-pace';
    if (isPastEndDate && completedStoryPoints < totalStoryPoints) {
        paceStatus = 'dnf';
    } else if (expectedStoryPoints > 0) {
        const pacePercentage = ((completedStoryPoints - expectedStoryPoints) / expectedStoryPoints) * 100;
        if (pacePercentage > 5) {
            paceStatus = 'ahead';
        } else if (pacePercentage < -5) {
            paceStatus = 'behind';
        }
    }

    return {
        requiredDailyPace: Math.round(requiredDailyPace * 10) / 10,
        actualDailyPace: Math.round(actualDailyPace * 10) / 10,
        paceStatus,
        daysRemaining,
        isPastEndDate,
        completedStoryPoints,
        expectedStoryPoints,
        totalStoryPoints,
        remainingStoryPoints
    };
}

module.exports = {
    calculatePace
};
