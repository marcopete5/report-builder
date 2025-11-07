// Shared mock data for test students
// Note: All students are Web Development until Cybersecurity lessons are added

// Current date: October 7, 2025
// All students started: May 30, 2025 (130 days ago)
// All students end: December 23, 2025 (77 days remaining)
// Total story points: 497
// Course duration: 28 weeks (196 days)
// Days elapsed: 130 days (66.3% of course)
// Expected story points by now: ~329 SP
// Expected pace: 2.5 pts/day

const MOCK_STUDENTS = {
    // Student 1: ~100 SP (Behind - well below expected 329 SP)
    rec001: {
        name: 'Alex Thompson',
        course: 'Web Development',
        institution: 'V School',
        startDate: '2025-05-30',
        endDate: '2025-12-23',
        mentor: 'Marcus Peterson'
    },

    // Student 2: ~300 SP (On Pace - close to expected 329 SP)
    rec002: {
        name: 'Jordan Martinez',
        course: 'Web Development',
        institution: 'Millersville University',
        startDate: '2025-05-30',
        endDate: '2025-12-23',
        mentor: 'Marcus Peterson'
    },

    // Student 3: ~380 SP (Ahead - above expected 329 SP)
    rec003: {
        name: 'Taylor Chen',
        course: 'Web Development',
        institution: 'TTU',
        startDate: '2025-05-30',
        endDate: '2025-12-23',
        mentor: 'Marcus Peterson'
    },

    // Student 4: 497 SP (Ahead - complete!)
    rec004: {
        name: 'Casey Rodriguez',
        course: 'Web Development',
        institution: 'UVU',
        startDate: '2025-05-30',
        endDate: '2025-12-23',
        mentor: 'Marcus Peterson'
    }
};

/**
 * Get mock student data by student ID
 * @param {string} studentId - The student's record ID
 * @returns {Object|null} Student data object or null if not found
 */
function getMockStudentData(studentId) {
    return MOCK_STUDENTS[studentId] || null;
}

module.exports = {
    getMockStudentData,
    MOCK_STUDENTS
};
