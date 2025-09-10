exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders(), body: '' };
    }
    return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
            ok: true,
            method: event.httpMethod,
            path: event.path,
            time: new Date().toISOString()
        })
    };
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}
