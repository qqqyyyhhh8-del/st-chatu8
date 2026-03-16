import http from 'node:http';

const target = process.env.COMFYUI_TARGET;
const username = process.env.COMFYUI_USERNAME ?? '';
const password = process.env.COMFYUI_PASSWORD ?? '';
const port = Number(process.env.PORT ?? '8189');
const bindHost = process.env.HOST ?? '127.0.0.1';

if (!target) {
    console.error('Missing COMFYUI_TARGET');
    process.exit(1);
}

const baseUrl = new URL(target);
const basicAuth = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function buildTargetUrl(req) {
    const incoming = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const nextUrl = new URL(incoming.pathname + incoming.search, baseUrl);
    return nextUrl;
}

function copyResponseHeaders(upstream, res, bodyLength) {
    upstream.headers.forEach((value, key) => {
        const lowered = key.toLowerCase();
        if (lowered === 'content-length') {
            return;
        }
        if (lowered === 'access-control-allow-origin') {
            return;
        }
        if (lowered === 'access-control-allow-methods') {
            return;
        }
        if (lowered === 'access-control-allow-headers') {
            return;
        }
        res.setHeader(key, value);
    });
    res.setHeader('Content-Length', String(bodyLength));
    setCorsHeaders(res);
}

const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        const upstreamUrl = buildTargetUrl(req);
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req);
        const headers = new Headers();

        for (const [key, value] of Object.entries(req.headers)) {
            if (value == null) {
                continue;
            }
            const lowered = key.toLowerCase();
            if (lowered === 'host' || lowered === 'origin' || lowered === 'authorization' || lowered === 'x-csrf-token') {
                continue;
            }
            if (Array.isArray(value)) {
                headers.set(key, value.join(', '));
            } else {
                headers.set(key, value);
            }
        }

        headers.set('Authorization', basicAuth);

        const upstream = await fetch(upstreamUrl, {
            method: req.method,
            headers,
            body,
        });

        const responseBody = Buffer.from(await upstream.arrayBuffer());
        copyResponseHeaders(upstream, res, responseBody.length);
        res.writeHead(upstream.status);
        res.end(responseBody);
    } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        setCorsHeaders(res);
        res.end(JSON.stringify({
            error: 'proxy_request_failed',
            message: error instanceof Error ? error.message : String(error),
        }));
    }
});

server.listen(port, bindHost, () => {
    console.log(`ComfyUI proxy listening on http://${bindHost}:${port}`);
    console.log(`Proxy target: ${baseUrl.origin}`);
});
