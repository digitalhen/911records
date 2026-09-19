import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Backend } from './backend';
import { createServer } from './server';
import { clientIp } from '../ask/rateLimit';

const buckets = new Map<string, { count: number; expires: number }>();
let active = 0;
const MAX_BODY = 16_384;
const reject = (status: number, message: string, headers = {}) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export function createHandler(db: Backend) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowedOrigins = new Set(['https://911records.org', 'https://www.911records.org', 'https://911records.nyc', 'https://www.911records.nyc']);
    if (process.env.NODE_ENV !== 'production') {
      const requestUrl = new URL(req.url);
      if (['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) allowedOrigins.add(requestUrl.origin);
    }
    if (origin && !allowedOrigins.has(origin)) return reject(403, 'Origin not allowed.');
    if (req.method !== 'POST') return reject(405, 'Use MCP Streamable HTTP POST requests.', { Allow: 'POST' });
    const now = Date.now();
    for (const [key, value] of buckets) if (value.expires <= now) buckets.delete(key);
    const ip = clientIp(req.headers);
    const bucket = buckets.get(ip);
    if (bucket && bucket.count >= 60) return reject(429, 'Too many requests.', { 'Retry-After': String(Math.ceil((bucket.expires - now) / 1000)) });
    if (active >= 12 || (!bucket && buckets.size >= 5000)) return reject(503, 'Server busy. Please retry.', { 'Retry-After': '5' });
    buckets.set(ip, { count: (bucket?.count ?? 0) + 1, expires: bucket?.expires ?? now + 60000 });
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reject(415, 'Content-Type must be application/json.');
    if (Number(req.headers.get('content-length')) > MAX_BODY) return reject(413, 'Request too large.');
    active++;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      const reader = req.body?.getReader();
      if (!reader) return reject(400, 'Missing request body.');
      let timedOut = false;
      const bodyTimer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10000);
      const chunks: Uint8Array[] = [];
      let length = 0;
      // Bound chunked bodies too; Content-Length cannot be trusted.
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_BODY) { await reader.cancel(); return reject(413, 'Request too large.'); }
          chunks.push(value);
        }
      } finally { clearTimeout(bodyTimer); reader.releaseLock(); }
      if (timedOut) return reject(408, 'Request body timed out.');
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reject(400, 'Invalid JSON.'); }
      // One request per transport: no sticky sessions needed across the two app replicas.
      server = createServer(db);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      const response = await transport.handleRequest(req, { parsedBody: body });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch {
      return reject(500, 'MCP request failed.');
    } finally {
      try { await server?.close(); } finally { active--; }
    }
  };
}
