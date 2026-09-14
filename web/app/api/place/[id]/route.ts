import { NextResponse } from 'next/server';
import { getPlaceFile } from '@/lib/map/data';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(id.length>200)return NextResponse.json({error:'Invalid building identifier'},{status:400});
  try {const file=await getPlaceFile(id);return NextResponse.json(file||{error:'Building not found'},{status:file?200:404,headers:{'Cache-Control':'no-store'}})}
  catch {return NextResponse.json({error:'Building index unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
