import type { NextRequest } from 'next/server';

// Runtime proxy for PDFs, page images and word-box files served by the
// `files` service (docker-compose.host.yml's nginx on StudioMac in
// production, scripts/files-dev-server.mjs in dev).
//
// This used to be a `rewrites()` entry in next.config.ts. That was wrong for
// this deployment: rewrites are evaluated when `next build` runs, and the
// image is built by Dokploy with no FILES_URL set, so the default
// 127.0.0.1:8911 was baked in and every /files/* request answered 500 in
// production while the same URL worked in dev. A route handler reads
// FILES_URL at request time, so the two Dokploy replicas can point at
// StudioMac's LAN IP through their runtime environment alone.
//
// Streams the upstream body (PDFs run to ~377 MB — never buffer), forwards
// Range and conditional headers so the browser's PDF viewer and caches work,
// and passes upstream status codes through unchanged (404 stays 404).
export const dynamic = 'force-dynamic';

const FILES_URL = () => (process.env.FILES_URL || 'http://127.0.0.1:8911').replace(/\/+$/, '');
const FORWARD_REQUEST = ['range', 'if-none-match', 'if-modified-since', 'accept'];
const FORWARD_RESPONSE = [
  'content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified',
  'cache-control', 'content-disposition',
];

async function proxy(req: NextRequest, path: string[], method: 'GET' | 'HEAD') {
  const segments = path.map((s) => encodeURIComponent(decodeURIComponent(s)));
  if (segments.some((s) => s === '.' || s === '..')) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  for (const h of FORWARD_REQUEST) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  let upstream: Response;
  try {
    upstream = await fetch(`${FILES_URL()}/${segments.join('/')}`, { method, headers, redirect: 'manual', cache: 'no-store' });
  } catch {
    return new Response('Files service unavailable', { status: 502 });
  }
  const out = new Headers();
  for (const h of FORWARD_RESPONSE) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  if (!out.has('cache-control')) out.set('cache-control', 'public, max-age=3600');
  return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path, 'GET'); }
export async function HEAD(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path, 'HEAD'); }
