import { NextResponse } from 'next/server';
import { getDocumentCount } from '@/lib/siteDb';
import { SITEMAP_CHUNK_SIZE } from '@/lib/sitemap';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

// Sitemap index (docs/PLAN.md SEO section). Documents only for now; entities,
// buildings and topics get their own <sitemap> lines once B4/B5 build those
// routes — leaving the hook here rather than a flat file per section.
export function GET() {
  const total = getDocumentCount();
  const chunks = Math.max(1, Math.ceil(total / SITEMAP_CHUNK_SIZE));
  const entries = Array.from({ length: chunks }, (_, i) => `  <sitemap><loc>${SITE_URL}/sitemaps/documents-${i}.xml</loc></sitemap>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
  return new NextResponse(body, { headers: { 'Content-Type': 'application/xml' } });
}
