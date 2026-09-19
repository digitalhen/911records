import { NextResponse } from 'next/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.org';

// docs/PLAN.md SEO section: allow everything except /ask, /a/, /case, /api/,
// /gone (the 410 notice — never worth indexing) and /files/ (raw PDFs and
// page images; keep Google pointed at the /doc page around each one instead
// of indexing the file directly).
export function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /ask
Disallow: /a/
Disallow: /case
Disallow: /api/
Disallow: /gone
Disallow: /files/

Sitemap: ${SITE_URL}/sitemap.xml
`;
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain' } });
}
