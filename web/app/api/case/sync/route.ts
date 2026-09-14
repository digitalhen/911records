import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';
import { loadCaseFolder, saveCaseFolder } from '@/lib/case/account';
import type { CaseItem } from '@/lib/case/types';

export const dynamic = 'force-dynamic';

// GET /api/case/sync — the signed-in account's case folder, for the
// pull-and-merge lib/case/store.ts does once on sign-in.
// POST /api/case/sync — replaces it with the caller's current (already
// locally merged) folder; lib/case/store.ts debounces this on every save().
// Both 401 when signed out; lib/case/store.ts never calls this path unless
// setAccountUser() has already seen a session.

function isCaseItem(x: unknown): x is CaseItem {
  if (!x || typeof x !== 'object') return false;
  const i = x as Record<string, unknown>;
  return typeof i.doc === 'string' && typeof i.page === 'number' && typeof i.batesPage === 'string';
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  try {
    const items = await loadCaseFolder(user.id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[api/case/sync] load failed', err);
    return NextResponse.json({ error: 'unavailable' }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items.filter(isCaseItem) : [];
  try {
    await saveCaseFolder(user.id, items);
    return NextResponse.json({ ok: true, count: items.length });
  } catch (err) {
    console.error('[api/case/sync] save failed', err);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}
