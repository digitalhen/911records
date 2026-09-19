import { NextResponse, type NextRequest } from 'next/server';

// Canonical domain migration. 308 preserves methods/bodies as well as paths and queries.
// Internal health probes use localhost/container hostnames, so they are never redirected.
const SITE_ORIGIN = 'https://911records.org';
const LEGACY_HOSTS = new Set(['911records.nyc', 'www.911records.nyc', 'www.911records.org']);

export function canonicalRedirect(req: NextRequest): NextResponse | null {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host = ((forwardedHost || req.headers.get('host') || req.nextUrl.hostname).split(',')[0] ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!LEGACY_HOSTS.has(host)) return null;
  const target = new URL(SITE_ORIGIN);
  target.pathname = req.nextUrl.pathname;
  target.search = req.nextUrl.search;
  return NextResponse.redirect(target, 308);
}

// Removed-by-the-City documents are not served publicly (docs/PLAN.md rule
// 6 and the SEO section: "Removed documents return 410 with a notice and
// safe metadata"). App Router page components can't set an arbitrary HTTP
// status, so this middleware rewrites /doc/<removed doc>* and
// /files/*/.../<removed doc>/... to /gone and sets the response status to
// 410 itself. The document viewer's in-page removal notice (rendered at 200)
// stays as a fallback for whenever this lookup is unavailable.
//
// The removed-id list comes from /api/removed (site.documents where
// status='removed'), fetched over HTTP rather than importing lib/db.ts
// directly — this file can run on the edge runtime, which can't load `pg`.
// The list is cached in this module's memory for 60s; a lookup failure
// fails OPEN (serves normally) rather than false-410ing every document.

const TTL_MS = 60_000;
let cached: { ids: Set<string>; expires: number } | null = null;

async function getRemovedIds(req: NextRequest): Promise<Set<string>> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.ids;
  try {
    const res = await fetch(new URL('/api/removed', req.url), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { ids?: unknown };
    const ids = new Set(Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []);
    cached = { ids, expires: now + TTL_MS };
    return ids;
  } catch {
    return cached?.ids ?? new Set();
  }
}

/** First dot-separated component of a path segment — strips `.pdf`, `.boxes.jsonl`, `.t.webp`, etc. so a bare doc/Bates id compares equal whether it names a directory or a filename stem. */
function stem(segment: string): string {
  const dot = segment.indexOf('.');
  return dot === -1 ? segment : segment.slice(0, dot);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Broad enough to catch the www redirect on every route (short of Next's own
// internals and static files); the removed-document check below still only
// does work for /doc and /files paths.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export async function middleware(req: NextRequest) {
  const redirect = canonicalRedirect(req);
  if (redirect) return redirect;

  const { pathname } = req.nextUrl;
  const segments = pathname.split('/').filter(Boolean).map(decodeSegment);
  if (!segments.length) return NextResponse.next();

  const isDoc = segments[0] === 'doc';
  const isFiles = segments[0] === 'files';
  if (!isDoc && !isFiles) return NextResponse.next();

  // /doc/<doc>[/p/<n>|/versions]: only the doc id itself is a candidate.
  // /files/pdf|page|text/<agency>/<volume>/...: the doc/Bates id can land in
  // different positions depending on resource type, so check every segment.
  const candidates = (isDoc ? segments.slice(1, 2) : segments.slice(1)).map(stem).filter(Boolean);
  if (!candidates.length) return NextResponse.next();

  const removed = await getRemovedIds(req);
  const matched = candidates.find((c) => removed.has(c));
  if (!matched) return NextResponse.next();

  const url = new URL('/gone', req.url);
  url.searchParams.set('doc', matched);
  return NextResponse.rewrite(url, { status: 410 });
}
