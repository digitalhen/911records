import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';
import { deleteSavedSearch } from '@/lib/account/savedSearches';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  const { id } = await params;
  try {
    await deleteSavedSearch(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/saved-searches] delete failed', err);
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
