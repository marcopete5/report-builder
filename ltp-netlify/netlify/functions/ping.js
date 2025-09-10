// /.netlify/functions/ping
exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: cors(), body: '' };
    }
    return {
        statusCode: 200,
        headers: cors(),
        body: JSON.stringify({
            ok: true,
            method: event.httpMethod,
            path: event.path,
            time: new Date().toISOString()
        })
    };
};

function cors() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}
