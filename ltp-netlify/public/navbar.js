// Shared navigation bar component
// This file provides functions to render a consistent navbar across all pages

/**
 * Get navbar HTML for client-side rendered pages (with role detection)
 * @param {Object} user - User object with role property
 * @returns {string} HTML string for navbar
 */
function getNavbarHTML(user) {
    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    const isStudent = user.role === 'student';

    return `
        <nav class="navbar">
            <div class="navbar-brand">
                <a href="/" class="navbar-logo">LTP Reports</a>
            </div>
            <div class="navbar-menu">
                <a href="/" class="navbar-item">🏠 Home</a>
                ${isAdmin ? `
                    <a href="/dashboards.html" class="navbar-item">📊 Dashboards</a>
                    <a href="/admin-users.html" class="navbar-item">👥 Users</a>
                    <a href="/.netlify/functions/report-weekly?view=html" class="navbar-item">📈 Weekly Report</a>
                    <a href="/.netlify/functions/db-inspect?format=pretty" class="navbar-item">🔍 Database</a>
                ` : ''}
                ${isStudent ? `
                    <a href="/" class="navbar-item">📈 My Progress</a>
                ` : ''}
            </div>
            <div class="navbar-end">
                <span class="navbar-user">${user.email}</span>
                <span class="role-badge role-${user.role}">${user.role}</span>
                <button class="btn btn-secondary" onclick="handleLogout()">Logout</button>
            </div>
        </nav>
    `;
}

/**
 * Get navbar HTML for server-side rendered pages (static, no role detection)
 * @param {string} role - User role ('admin', 'superadmin', or 'student')
 * @param {string} email - User email
 * @returns {string} HTML string for navbar
 */
function getStaticNavbarHTML(role, email) {
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isStudent = role === 'student';

    return `
        <nav class="navbar">
            <div class="navbar-brand">
                <a href="/" class="navbar-logo">LTP Reports</a>
            </div>
            <div class="navbar-menu">
                <a href="/" class="navbar-item">🏠 Home</a>
                ${isAdmin ? `
                    <a href="/dashboards.html" class="navbar-item">📊 Dashboards</a>
                    <a href="/admin-users.html" class="navbar-item">👥 Users</a>
                    <a href="/.netlify/functions/report-weekly?view=html" class="navbar-item">📈 Weekly Report</a>
                    <a href="/.netlify/functions/db-inspect?format=pretty" class="navbar-item">🔍 Database</a>
                ` : ''}
                ${isStudent ? `
                    <a href="/" class="navbar-item">📈 My Progress</a>
                ` : ''}
            </div>
            <div class="navbar-end">
                <span class="navbar-user">${email}</span>
                <span class="role-badge role-${role}">${role}</span>
                <button class="btn btn-secondary" onclick="location.href='/.netlify/functions/auth-logout'">Logout</button>
            </div>
        </nav>
    `;
}

/**
 * Get CSS styles for navbar
 * @returns {string} CSS string for navbar styling
 */
function getNavbarCSS() {
    return `
        .navbar {
            background: white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 0 2rem;
            display: flex;
            align-items: center;
            gap: 2rem;
            height: 64px;
        }
        .navbar-brand {
            display: flex;
            align-items: center;
        }
        .navbar-logo {
            font-size: 1.5rem;
            font-weight: 600;
            color: #2d3748;
            text-decoration: none;
        }
        .navbar-logo:hover {
            color: #4299e1;
        }
        .navbar-menu {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex: 1;
        }
        .navbar-item {
            padding: 0.5rem 1rem;
            color: #4a5568;
            text-decoration: none;
            font-size: 0.875rem;
            font-weight: 500;
            border-radius: 0.375rem;
            transition: all 0.2s;
        }
        .navbar-item:hover {
            background: #f7fafc;
            color: #4299e1;
        }
        .navbar-end {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        .navbar-user {
            color: #718096;
            font-size: 0.875rem;
        }
        .role-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        .role-superadmin {
            background: #fbd38d;
            color: #744210;
        }
        .role-admin {
            background: #fed7d7;
            color: #c53030;
        }
        .role-student {
            background: #c6f6d5;
            color: #276749;
        }
        .btn {
            padding: 0.5rem 1rem;
            border-radius: 0.375rem;
            border: none;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s;
        }
        .btn-secondary {
            background: #e2e8f0;
            color: #2d3748;
        }
        .btn-secondary:hover {
            background: #cbd5e0;
        }

        @media (max-width: 768px) {
            .navbar {
                padding: 0 1rem;
                gap: 1rem;
                height: auto;
                min-height: 64px;
                flex-wrap: wrap;
            }
            .navbar-menu {
                order: 3;
                flex-basis: 100%;
                padding: 0.5rem 0;
                gap: 0.25rem;
            }
            .navbar-user {
                display: none;
            }
        }
    `;
}

// For Node.js (server-side) usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getStaticNavbarHTML,
        getNavbarCSS
    };
}
