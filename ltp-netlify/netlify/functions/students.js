// /.netlify/functions/students

const { getCorsHeaders } = require('./utils/cors');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: getCorsHeaders('GET,OPTIONS'), body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const {
        AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID,
        AIRTABLE_TABLE = 'Students',
        AIRTABLE_VIEW
    } = process.env;
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_VIEW) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Missing Airtable env vars' })
        };
    }

    try {
        const baseUrl = `https://api.airtable.com/v0/${encodeURIComponent(
            AIRTABLE_BASE_ID
        )}/${encodeURIComponent(AIRTABLE_TABLE)}`;
        const headers = {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
        };

        let url = `${baseUrl}?view=${encodeURIComponent(
            AIRTABLE_VIEW
        )}&pageSize=100`;
        const out = [];

        for (let guard = 0; guard < 50; guard++) {
            const r = await fetch(url, { headers }); // 👈 using global fetch
            if (!r.ok) {
                const text = await r.text();
                return {
                    statusCode: r.status,
                    headers: getCorsHeaders('GET,OPTIONS'),
                    body: JSON.stringify({
                        error: 'Airtable fetch failed',
                        text
                    })
                };
            }
            const data = await r.json();
            for (const rec of data.records || []) {
                const f = rec.fields || {};
                const name =
                    f['Display Name'] ||
                    f['Full Name'] ||
                    f['Name'] ||
                    f['Student Name'] ||
                    [f['First Name'], f['Last Name']]
                        .filter(Boolean)
                        .join(' ')
                        .trim();
                if (name) out.push({ id: rec.id, name });
            }
            if (data.offset) {
                url = `${baseUrl}?view=${encodeURIComponent(
                    AIRTABLE_VIEW
                )}&pageSize=100&offset=${encodeURIComponent(data.offset)}`;
            } else break;
        }

        out.sort((a, b) => a.name.localeCompare(b.name));
        return {
            statusCode: 200,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ students: out })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: getCorsHeaders('GET,OPTIONS'),
            body: JSON.stringify({ error: 'Server error' })
        };
    }
};
