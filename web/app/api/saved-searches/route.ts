import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';
import { createSavedSearch, listSavedSearches, SavedSearchLimitError } from '@/lib/account/savedSearches';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  try {
    const searches = await listSavedSearches(user.id);
    return NextResponse.json({ searches });
  } catch (err) {
    console.error('[api/saved-searches] list failed', err);
    return NextResponse.json({ searches: [], error: 'unavailable' }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  let body: { label?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const params = typeof body.params === 'string' ? body.params : '';
  if (!params.trim()) return NextResponse.json({ error: 'nothing to save' }, { status: 400 });
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : `Search: ${params}`;
  try {
    const search = await createSavedSearch(user.id, label, params);
    return NextResponse.json({ search });
  } catch (err) {
    if (err instanceof SavedSearchLimitError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[api/saved-searches] create failed', err);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}
