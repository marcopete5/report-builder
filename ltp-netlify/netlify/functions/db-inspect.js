// /.netlify/functions/db-inspect
// Database inspection utility - view collections and documents
// PROTECTED: Admin access only

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Check authentication - only admins can access db-inspect
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const q = event.queryStringParameters || {};
        const collection = q.collection;
        const limit = parseInt(q.limit || '100', 10);
        const skip = parseInt(q.skip || '0', 10);
        const format = q.format || 'json';

        const db = await getDb();

        // If no collection specified, list all collections
        if (!collection) {
            const collections = await db.listCollections().toArray();
            const collectionNames = collections.map(c => c.name);

            // Get counts for each collection
            const collectionInfo = await Promise.all(
                collectionNames.map(async (name) => {
                    const coll = db.collection(name);
                    const count = await coll.countDocuments();
                    return { name, count };
                })
            );

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    database: db.databaseName,
                    collections: collectionInfo,
                    usage: 'Add ?collection=<name> to view documents, ?limit=N to limit results, ?skip=N to paginate'
                })
            };
        }

        // Get documents from specified collection
        const coll = db.collection(collection);
        const total = await coll.countDocuments();
        const documents = await coll.find({})
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get sample of field names from first document
        const sampleFields = documents.length > 0 ? Object.keys(documents[0]) : [];

        const response = {
            collection,
            total,
            returned: documents.length,
            skip,
            limit,
            sampleFields,
            documents
        };

        if (format === 'pretty') {
            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'text/html' },
                body: renderHtml(response)
            };
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(response, null, 2)
        };

    } catch (err) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Server error', details: err.message })
        };
    }
};

function renderHtml(data) {
    const { collection, total, returned, skip, limit, sampleFields, documents } = data;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>DB Inspector - ${collection || 'Collections'}</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        h1 { margin: 0 0 10px; }
        .info { background: #e3f2fd; padding: 10px; border-radius: 4px; margin-bottom: 20px; }
        .nav { margin-bottom: 20px; }
        .nav a { margin-right: 10px; padding: 8px 12px; background: #2196f3; color: white; text-decoration: none; border-radius: 4px; }
        .nav a:hover { background: #1976d2; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f5f5f5; font-weight: 600; position: sticky; top: 0; }
        tr:hover { background: #f9f9f9; }
        .json { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 12px; white-space: pre; }
        .pagination { margin-top: 20px; }
        .pagination a { margin-right: 10px; padding: 6px 10px; background: #eee; text-decoration: none; border-radius: 4px; color: #333; }
        .pagination a:hover { background: #ddd; }
        select { padding: 8px; border-radius: 4px; border: 1px solid #ddd; }
    </style>
</head>
<body>
    <div class="container">
        ${collection ? `
            <h1>Collection: ${collection}</h1>
            <div class="info">
                <strong>Total documents:</strong> ${total} |
                <strong>Showing:</strong> ${returned} (skip: ${skip}, limit: ${limit})
            </div>
            <div class="nav">
                <a href="?">← Back to Collections</a>
                ${skip > 0 ? `<a href="?collection=${collection}&skip=${Math.max(0, skip - limit)}&limit=${limit}&format=pretty">← Previous</a>` : ''}
                ${skip + limit < total ? `<a href="?collection=${collection}&skip=${skip + limit}&limit=${limit}&format=pretty">Next →</a>` : ''}
                <select onchange="window.location.href='?collection=${collection}&limit='+this.value+'&format=pretty'">
                    <option value="10" ${limit === 10 ? 'selected' : ''}>10 per page</option>
                    <option value="25" ${limit === 25 ? 'selected' : ''}>25 per page</option>
                    <option value="50" ${limit === 50 ? 'selected' : ''}>50 per page</option>
                    <option value="100" ${limit === 100 ? 'selected' : ''}>100 per page</option>
                    <option value="500" ${limit === 500 ? 'selected' : ''}>500 per page</option>
                </select>
            </div>
            ${documents.length > 0 ? `
                <div style="overflow-x: auto;">
                    <table>
                        <thead>
                            <tr>
                                ${sampleFields.map(f => `<th>${escapeHtml(f)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${documents.map(doc => `
                                <tr>
                                    ${sampleFields.map(field => {
                                        const value = doc[field];
                                        let display;
                                        if (value === null || value === undefined) {
                                            display = '<em>null</em>';
                                        } else if (typeof value === 'object') {
                                            display = '<code>' + escapeHtml(JSON.stringify(value)) + '</code>';
                                        } else {
                                            display = escapeHtml(String(value));
                                        }
                                        return `<td>${display}</td>`;
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<p>No documents found</p>'}
            <div class="pagination">
                ${skip > 0 ? `<a href="?collection=${collection}&skip=${Math.max(0, skip - limit)}&limit=${limit}&format=pretty">← Previous</a>` : ''}
                ${skip + limit < total ? `<a href="?collection=${collection}&skip=${skip + limit}&limit=${limit}&format=pretty">Next →</a>` : ''}
            </div>
        ` : `
            <h1>Database Collections</h1>
            <div class="info">
                Click a collection to view its documents
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Collection Name</th>
                        <th>Document Count</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.collections.map(c => `
                        <tr>
                            <td><strong>${escapeHtml(c.name)}</strong></td>
                            <td>${c.count}</td>
                            <td>
                                <a href="?collection=${encodeURIComponent(c.name)}&format=pretty" style="background: #2196f3; color: white; padding: 4px 8px; text-decoration: none; border-radius: 3px; font-size: 12px;">View</a>
                                <a href="?collection=${encodeURIComponent(c.name)}&format=json" style="background: #4caf50; color: white; padding: 4px 8px; text-decoration: none; border-radius: 3px; font-size: 12px; margin-left: 5px;">JSON</a>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `}
    </div>
</body>
</html>`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
