import { captchaGate } from '@/lib/downloads/captcha';
import { currentDownloads, downloadsOrigin } from '@/lib/downloads/catalog';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ name: string }> };
const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };
async function serve(request: Request, context: Context, method: 'GET' | 'HEAD') {
  const gate = captchaGate(request);
  if (gate) return gate;
  const { name } = await context.params;
  try {
    const catalog = await currentDownloads();
    if (!catalog) return new Response('Downloads are being refreshed. Please try again shortly.', { status: 503, headers: { ...noStore, 'Retry-After': '300' } });
    if (name === 'index.json') return new Response(method === 'HEAD' ? null : JSON.stringify(catalog), { headers: { ...noStore, 'Content-Type': 'application/json' } });
    const file = name === 'manifest.json' ? catalog.manifest : name;
    const archive = [catalog.full, ...catalog.boxes].find(a => a.name === file);
    if (file !== catalog.manifest && !archive) {
      return new Response('This download is no longer current. Visit /downloads for its replacement.', { status: 410, headers: noStore });
    }
    if (!/^(?:collection|box|manifest)-[a-f0-9]{64}\.(?:zip|json)$/.test(file)) throw new Error('Invalid archive name');
    const headers = new Headers();
    for (const key of ['range', 'if-range']) {
      const value = request.headers.get(key); if (value) headers.set(key, value);
    }
    const upstream = await fetch(`${downloadsOrigin()}/${file}`, { method, headers, cache: 'no-store', signal: request.signal });
    const out = new Headers(noStore);
    for (const key of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(key); if (value) out.set(key, value);
    }
    out.set('Content-Type', upstream.headers.get('content-type') || (file.endsWith('.zip') ? 'application/zip' : 'application/json'));
    const label = archive === catalog.full ? 'collection' : [archive?.agency, archive?.box || 'unlabelled', archive?.volume].filter(Boolean).join('-');
    const filename = archive
      ? `911records-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 140)}-${(catalog.snapshot_date || 'current').replace(/[^0-9a-z-]/g, '')}.zip`
      : '911records-manifest.json';
    out.set('Content-Disposition', `attachment; filename="${filename}"`);
    out.set('X-Content-Type-Options', 'nosniff');
    return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    console.error('[downloads] unavailable', error instanceof Error ? error.message : 'unknown');
    return new Response('Downloads are temporarily unavailable.', { status: 503, headers: { ...noStore, 'Retry-After': '300' } });
  }
}
export const GET = (request: Request, context: Context) => serve(request, context, 'GET');
export const HEAD = (request: Request, context: Context) => serve(request, context, 'HEAD');
