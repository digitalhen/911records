import { NextResponse } from 'next/server';
import { queryReadSafe } from '@/lib/db';

// Internal lookup used only by middleware.ts to rewrite requests for removed
// documents to a real HTTP 410 (docs/PLAN.md SEO section: "Removed documents
// return 410 with a notice and safe metadata"). Not linked publicly; listed
// in robots.txt's disallow for /api/.
export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await queryReadSafe<{ doc: string }>("SELECT doc FROM site.documents WHERE status = 'removed'");
  return NextResponse.json({ ids: rows.map((r) => r.doc) }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
