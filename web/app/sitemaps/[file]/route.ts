import { NextResponse } from 'next/server';
import { getDocIdsPage } from '@/lib/siteDb';
import { SITEMAP_CHUNK_SIZE } from '@/lib/sitemap';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

// Matches /sitemaps/documents-0.xml, documents-1.xml, ... (App Router dynamic
// segments can't mix a literal prefix into the folder name, so this one
// segment parses "documents-<n>.xml" itself instead of a documents-[n] folder).
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = /^documents-(\d+)\.xml$/.exec(file);
  if (!m) return new NextResponse('Not found', { status: 404 });
  const n = Number(m[1]);
  const docs = getDocIdsPage(n * SITEMAP_CHUNK_SIZE, SITEMAP_CHUNK_SIZE);
  const entries = docs.map((doc) => `  <url><loc>${SITE_URL}/doc/${doc}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  return new NextResponse(body, { headers: { 'Content-Type': 'application/xml' } });
}
