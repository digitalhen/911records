import { NextResponse } from 'next/server';
import { saveReport } from '@/lib/info/reports';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({error:'Submit reports from this site.'},{status:403});
  if (Number(request.headers.get('content-length') || 0) > 16000) return NextResponse.json({error:'Report is too long.'},{status:413});
  const json = request.headers.get('content-type')?.includes('application/json');
  let data: Record<string,unknown>;
  try {
    // Bound actual bytes too: Content-Length is not required or trusted.
    const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (!reader) throw new Error('empty');
    while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > 16000) { await reader.cancel(); return NextResponse.json({error:'Report is too long.'},{status:413}); } chunks.push(value); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (json) data = JSON.parse(text);
    else if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) data = Object.fromEntries(new URLSearchParams(text));
    else return NextResponse.json({error:'Use JSON or a URL-encoded form.'},{status:415});
    if (!data || typeof data !== 'object') throw new Error('invalid');
  } catch { return NextResponse.json({error:'Invalid report.'},{status:400}); }
  const bates = typeof data.bates === 'string' ? data.bates.trim().toUpperCase() : '';
  const location = typeof data.location === 'string' ? data.location.trim() : '';
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (!/^NYC-WTC_\d{9}$/.test(bates) || !location || location.length > 500 || !note || note.length > 4000) return NextResponse.json({error:'Enter a Bates page (NYC-WTC_ followed by nine digits), a location (up to 500 characters) and a note (up to 4,000 characters). Do not repeat private details.'},{status:400});
  try {
    const id = await saveReport(bates,location,note);
    return json ? NextResponse.json({id, message:'Report received. Keep this reference.'},{status:201}) : NextResponse.redirect(new URL(`/personal-information?received=${id}#report`,request.url),303);
  } catch { return NextResponse.json({error:'The report could not be saved. Please try again later, or report it through the City’s official portal.'},{status:503}); }
}
