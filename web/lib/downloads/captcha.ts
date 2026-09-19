import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GRANT_SECONDS = 12 * 60 * 60;
export const ACTION = 'bulk_download';
export const COOKIE_NAME = 'downloads_verified';
const TEST_SITE_KEY = '1x00000000000000000000AA';
const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export interface CaptchaConfig {
  siteKey: string;
  secretKey: string;
  sessionSecret: string;
  testMode: boolean;
  production: boolean;
  origin: string;
}

export function captchaConfig(env = process.env): CaptchaConfig | null {
  const production = env.NODE_ENV === 'production';
  const testMode = !production && env.TURNSTILE_TEST_MODE === '1';
  const siteKey = testMode ? TEST_SITE_KEY : env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = testMode ? TEST_SECRET_KEY : env.TURNSTILE_SECRET_KEY?.trim();
  const sessionSecret = env.DOWNLOAD_SESSION_SECRET?.trim();
  if (!siteKey || !secretKey || !sessionSecret || sessionSecret.length < 32) return null;
  // Never let published Cloudflare test credentials unlock production downloads.
  if (production && (/^[123]x0+/.test(siteKey) || /^[123]x0+/.test(secretKey))) return null;
  return { siteKey, secretKey, sessionSecret, testMode, production, origin: 'https://911records.org' };
}

function signature(payload: string, key: string) {
  return createHmac('sha256', key).update(`downloads:v1:${payload}`).digest('base64url');
}

export function issueGrant(key: string, now = Date.now(), audience: 'live' | 'preview' = 'live'): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1, audience, issued: now, expires: now + GRANT_SECONDS * 1000, nonce: randomBytes(16).toString('hex'),
  })).toString('base64url');
  return `${payload}.${signature(payload, key)}`;
}

export function validGrant(value: string | undefined, key: string, now = Date.now(), audience: 'live' | 'preview' = 'live'): boolean {
  if (!value || value.length > 1024) return false;
  const [payload, supplied, extra] = value.split('.');
  if (!payload || !supplied || extra !== undefined || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(supplied)) return false;
  const expected = Buffer.from(signature(payload, key));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return grant.version === 1 && grant.audience === audience && Number.isSafeInteger(grant.issued) && Number.isSafeInteger(grant.expires)
      && grant.issued <= now && grant.expires > now && grant.expires - grant.issued === GRANT_SECONDS * 1000;
  } catch { return false; }
}

export function hasDownloadGrant(request: Request, config: CaptchaConfig): boolean {
  const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return validGrant(cookie, config.sessionSecret, Date.now(), config.testMode ? 'preview' : 'live');
}

export function downloadName(value: unknown): value is string {
  return typeof value === 'string' && (
    value === 'manifest.json' || value === 'index.json'
    || /^(?:collection|box)-[a-f0-9]{64}\.zip$/.test(value)
    || /^manifest-[a-f0-9]{64}\.json$/.test(value)
  );
}

export function captchaGate(request: Request): Response | null {
  const config = captchaConfig();
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  if (!config) return new Response('Download verification is temporarily unavailable. Please try again later.', { status: 503, headers });
  if (hasDownloadGrant(request, config)) return null;
  if (request.method === 'HEAD') return new Response(null, { status: 403, headers });
  const name = new URL(request.url).pathname.split('/').pop() || '';
  if (!downloadName(name)) return new Response('Not found', { status: 404, headers });
  return new Response(null, { status: 303, headers: { ...headers, Location: `/downloads/verify?file=${encodeURIComponent(name)}` } });
}

// Per-process limit bounds calls to Siteverify, including invalid-token attempts.
// Each web replica has its own bucket; verification is never skipped on a cache hit.
export function verificationHandler(
  getConfig: () => CaptchaConfig | null = captchaConfig,
  fetcher: typeof fetch = fetch,
) {
  const attempts = new Map<string, { count: number; until: number }>();
  return async (request: Request) => {
    const reply = (body: object, status: number, extra: Record<string, string> = {}) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...extra } });
    const config = getConfig();
    if (!config) return reply({ error: 'Download verification is temporarily unavailable. Please try again later.' }, 503);
    const origin = config.production ? config.origin : new URL(request.url).origin;
    if (request.headers.get('origin') !== origin) return reply({ error: 'Complete verification on this site.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Expected JSON.' }, 415);
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const bucket = attempts.get(ip);
    if ((bucket?.count || 0) >= 10 || (!bucket && attempts.size >= 5000)) {
      return reply({ error: 'Too many attempts. Please try again in ten minutes.' }, 429, { 'Retry-After': '600' });
    }
    attempts.set(ip, { count: (bucket?.count || 0) + 1, until: bucket?.until || now + 600_000 });
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Complete the verification first.' }, 400);
    let expired = false;
    const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 5000);
    let input: { token?: unknown; file?: unknown };
    try {
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8192) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413); }
        chunks.push(value);
      }
      if (expired) return reply({ error: 'Verification timed out. Please try again.' }, 408);
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input !== 'object') throw new Error('Invalid body');
    } catch { return reply({ error: 'Invalid verification request.' }, 400); }
    finally { clearTimeout(timer); reader.releaseLock(); }
    if (typeof input.token !== 'string' || !input.token.trim() || input.token.length > 2048 || !downloadName(input.file)) {
      return reply({ error: 'Complete the verification and choose a download.' }, 400);
    }
    try {
      const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: config.secretKey, response: input.token }),
        signal: AbortSignal.timeout(10_000), cache: 'no-store',
      });
      if (!response.ok) throw new Error('Verification provider unavailable');
      const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
      if (result.success !== true || (!config.testMode && (
        result.hostname !== new URL(origin).hostname || result.action !== ACTION
      ))) return reply({ error: 'Verification failed or expired. Please try again.' }, 403);
      const cookie = `${COOKIE_NAME}=${issueGrant(config.sessionSecret, Date.now(), config.testMode ? 'preview' : 'live')}; Path=/api/downloads; HttpOnly; SameSite=Lax; Max-Age=${GRANT_SECONDS}${config.production || new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
      return reply({ download: `/api/downloads/${encodeURIComponent(input.file)}` }, 200, { 'Set-Cookie': cookie });
    } catch { return reply({ error: 'Verification is temporarily unavailable. Please try again.' }, 503); }
  };
}
