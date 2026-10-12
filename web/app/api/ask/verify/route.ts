import { verifyAskCaptcha } from '@/lib/ask/captcha';
import { issueAskGrant } from '@/lib/ask/grant';
import { captchaConfig } from '@/lib/downloads/captcha';
import { clientIp } from '@/lib/ask/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const attempts = new Map<string, { count: number; until: number }>();
const reply = (error: string, status: number) => Response.json({ error }, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

export async function POST(request: Request) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const ip = clientIp(request.headers), bucket = attempts.get(ip);
  if ((bucket?.count || 0) >= 10 || (!bucket && attempts.size >= 5000)) {
    return reply('Too many verification attempts. Please try again in ten minutes.', 429);
  }
  attempts.set(ip, { count: (bucket?.count || 0) + 1, until: bucket?.until || now + 600_000 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) return reply('Complete verification first.', 400);
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 5000);
  let input: Record<string, unknown>;
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); return reply('Request too large.', 413); }
      chunks.push(value);
    }
    if (expired) return reply('Verification timed out.', 408);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input');
  } catch { return reply('Invalid request.', 400); }
  finally { clearTimeout(timer); reader.releaseLock(); }

  const sp: Record<string, string> = {};
  for (const key of ['q', 'parent', 'refresh', 'mode']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || (input[key] as string).length > (key === 'q' ? 2000 : 100)) {
      return reply('The question or answer reference is too long.', 400);
    }
    sp[key] = input[key] as string;
  }
  if (!sp.q?.trim() && !sp.refresh) return reply('Enter a question first.', 400);
  const config = captchaConfig();
  const error = await verifyAskCaptcha(input.token, request.headers, config);
  if (error) return reply(error, config ? 403 : 503);
  try {
    const grant = await issueAskGrant(sp);
    return Response.json({ location: `/ask?${new URLSearchParams(sp)}` }, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Set-Cookie': `ask_verified=${grant}; Path=/ask; HttpOnly; SameSite=Strict; Max-Age=120${config?.production ? '; Secure' : ''}`,
      },
    });
  } catch {
    return reply('AI verification is temporarily unavailable. Please try again.', 503);
  }
}
