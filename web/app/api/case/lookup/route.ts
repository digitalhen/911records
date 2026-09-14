import { NextResponse } from 'next/server';
import { lookupDocs } from '@/lib/case/lookup';

export const dynamic = 'force-dynamic';

// GET /api/case/lookup?docs=a,b,c — refreshes case-folder metadata (Bates
// range, official URL, removal status) from Postgres for the docs a visitor
// has saved client-side. Read-only, no request body, nothing written.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const docs = (url.searchParams.get('docs') || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  if (!docs.length) return NextResponse.json({ docs: {} });
  try {
    const found = await lookupDocs(docs);
    return NextResponse.json({ docs: found });
  } catch {
    return NextResponse.json({ docs: {}, error: 'lookup unavailable' }, { status: 200 });
  }
}
