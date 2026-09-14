import { NextResponse } from 'next/server';
import { suggestForCase } from '@/lib/case/lookup';

export const dynamic = 'force-dynamic';

interface Body {
  items?: { doc?: unknown; page?: unknown; label?: unknown }[];
}

// POST /api/case/suggestions {items:[{doc,page,label}]} — "case-folder
// suggestions": records similar to already-saved pages, not yet saved. The
// case folder itself is browser-local (no accounts, nothing stored here);
// this only reads OpenSearch/Postgres through the existing more-like-this
// helper (lib/discovery/moreLikeThis.ts) and returns candidates, one-line
// reason included.
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ suggestions: [], unavailable: false });
  }
  const items = Array.isArray(body.items)
    ? body.items
        .filter(
          (i): i is { doc: string; page: number; label: string } =>
            typeof i.doc === 'string' && Number.isInteger(i.page) && (i.page as number) > 0,
        )
        .map((i) => ({ doc: i.doc, page: i.page, label: typeof i.label === 'string' && i.label ? i.label : i.doc }))
        .slice(0, 60)
    : [];
  try {
    const result = await suggestForCase(items);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ suggestions: [], unavailable: true });
  }
}
