import { NextRequest, NextResponse } from 'next/server';
import { normalizeBates } from '@/lib/paths';
import { getPageByBates } from '@/lib/siteDb';
import { findExactBates } from '@/lib/opensearch';

// /page/<bates_page> redirects to the document and page that carries that
// Bates stamp (docs/PLAN.md URL scheme). Tries site.sqlite first (fast,
// authoritative once the pipeline has run); falls back to OpenSearch, which
// is populated first during the initial mirror.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ bates: string }> }) {
  const { bates: raw } = await params;
  const bates = normalizeBates(raw) || raw;

  const fromDb = getPageByBates(bates);
  if (fromDb) {
    return NextResponse.redirect(
      new URL(fromDb.page > 1 ? `/doc/${fromDb.doc}/p/${fromDb.page}` : `/doc/${fromDb.doc}`, _req.url),
    );
  }

  const fromIndex = await findExactBates(bates);
  if (fromIndex) {
    return NextResponse.redirect(
      new URL(fromIndex.page > 1 ? `/doc/${fromIndex.doc}/p/${fromIndex.page}` : `/doc/${fromIndex.doc}`, _req.url),
    );
  }

  return NextResponse.json({ error: `No document found for Bates page ${bates}` }, { status: 404 });
}
