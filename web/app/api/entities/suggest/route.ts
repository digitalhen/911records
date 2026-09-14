import { NextResponse } from 'next/server';
import { suggestEntities } from '@/lib/discovery/data';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim().slice(0,120) || '';
  if (!q) return NextResponse.json([]);
  try { return NextResponse.json(await suggestEntities(q), {headers:{'Cache-Control':'no-store'}}); }
  catch { return NextResponse.json({error:'Entity suggestions are temporarily unavailable.'},{status:503}); }
}
