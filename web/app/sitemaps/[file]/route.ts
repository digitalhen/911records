import { NextResponse } from 'next/server';
import { getDocIdsWithDatesPage } from '@/lib/site';
import { SITEMAP_CHUNK_SIZE } from '@/lib/sitemap';
import { informationSitemapPaths } from '@/lib/info/sitemap';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

// Matches /sitemaps/documents-0.xml, documents-1.xml, ... (App Router dynamic
// segments can't mix a literal prefix into the folder name, so this one
// segment parses "documents-<n>.xml" itself instead of a documents-[n] folder)
// and /sitemaps/info.xml (browse/changes/policy pages, from B2's
// lib/info/sitemap.ts — small enough for a single chunk).
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (file === 'info.xml') {
    const paths = await informationSitemapPaths();
    const entries = paths.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
    return new NextResponse(body, { headers: { 'Content-Type': 'application/xml' } });
  }
  const m = /^documents-(\d+)\.xml$/.exec(file);
  if (!m) return new NextResponse('Not found', { status: 404 });
  const n = Number(m[1]);
  const docs = await getDocIdsWithDatesPage(n * SITEMAP_CHUNK_SIZE, SITEMAP_CHUNK_SIZE);
  const entries = docs
    .map((d) => `  <url><loc>${SITE_URL}/doc/${d.doc}</loc>${d.lastmod ? `<lastmod>${d.lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  return new NextResponse(body, { headers: { 'Content-Type': 'application/xml' } });
}
