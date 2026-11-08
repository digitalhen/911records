import { isSiteOrigin, SITE_NAME } from '@/lib/brand';
import { createShortlink } from '@/lib/shortlinks/store';
import { normalizeTarget } from '@/lib/shortlinks/paths';
import { clientIp } from '@/lib/ask/rateLimit';
import { hit } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && !isSiteOrigin(origin) && !(process.env.NODE_ENV !== 'production' && origin === new URL(req.url).origin)) return Response.json({ error: 'Origin not allowed.' }, { status: 403 });
  if (!(await hit('shortlinks', clientIp(req.headers), 30, 60_000)).ok) return Response.json({ error: 'Please try again in a minute.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected JSON.' }, { status: 415 });
  const reader = req.body?.getReader();
  if (!reader) return Response.json({ error: 'Missing URL.' }, { status: 400 });
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 10000);
  let target: string;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return Response.json({ error: 'URL too long.' }, { status: 413 }); }
      chunks.push(value);
    }
    if (expired) return Response.json({ error: 'Request timed out.' }, { status: 408 });
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body.url !== 'string') throw new Error();
    target = normalizeTarget(body.url);
  } catch { return Response.json({ error: `Provide a valid ${SITE_NAME} page URL.` }, { status: 400 }); }
  finally { clearTimeout(timer); reader.releaseLock(); }
  try { return Response.json(await createShortlink(target), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Shortlink unavailable. Please copy the full URL.' }, { status: 503 }); }
}
