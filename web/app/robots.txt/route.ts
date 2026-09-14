import { NextResponse } from 'next/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

// docs/PLAN.md SEO section: allow everything except /ask, /a/, /case, /api/.
export function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /ask
Disallow: /a/
Disallow: /case
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain' } });
}
