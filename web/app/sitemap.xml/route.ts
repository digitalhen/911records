import { NextResponse } from 'next/server';
import { getDocumentCount } from '@/lib/site';
import { SITEMAP_CHUNK_SIZE } from '@/lib/sitemap';
import { discoverySitemapCount } from '@/lib/discovery/sitemap';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.org';
const DISCOVERY_CHUNK_SIZE = 5000;

// Depends on a live doc count from Postgres — must not be statically
// prerendered at build time (no DB is reachable during `docker build`), and
// the count itself changes as the corpus grows.
export const dynamic = 'force-dynamic';

// Sitemap index (docs/PLAN.md SEO section): documents (chunked), the info
// pages (browse/changes/policy, B2's lib/info/sitemap.ts), entities/
// signatories/topics (chunked, B4's lib/discovery/sitemap.ts) and buildings
// (B5's /building/sitemap.xml).
export async function GET() {
  const [total, discoveryTotal] = await Promise.all([getDocumentCount(), discoverySitemapCount().catch(() => 0)]);
  const documentChunks = Math.max(1, Math.ceil(total / SITEMAP_CHUNK_SIZE));
  const discoveryChunks = Math.max(1, Math.ceil(discoveryTotal / DISCOVERY_CHUNK_SIZE));

  const entries = [
    ...Array.from({ length: documentChunks }, (_, i) => `${SITE_URL}/sitemaps/documents-${i}.xml`),
    `${SITE_URL}/sitemaps/info.xml`,
    ...Array.from({ length: discoveryChunks }, (_, i) => `${SITE_URL}/entities/sitemap.xml?chunk=${i}`),
    `${SITE_URL}/building/sitemap.xml`,
  ]
    .map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`)
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
  return new NextResponse(body, { headers: { 'Content-Type': 'application/xml' } });
}
