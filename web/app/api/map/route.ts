import { NextResponse } from 'next/server';
import { getMapPlaces } from '@/lib/map/data';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const q=new URL(req.url).searchParams;
  const from=Number(q.get('from')??0),to=Number(q.get('to')??27),type=q.get('type')||'',substance=q.get('substance')||'';
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to>27||from>to||!['','test','inspection','mention'].includes(type)||substance.length>100)
    return NextResponse.json({error:'Invalid map filters'},{status:400});
  try {return NextResponse.json({places:await getMapPlaces({from,to,type,substance,only:q.get('only')==='true'})},{headers:{'Cache-Control':'no-store'}})}
  catch {return NextResponse.json({error:'Building index unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
