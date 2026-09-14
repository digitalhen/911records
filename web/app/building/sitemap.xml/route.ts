import { buildingSitemapEntries } from '@/lib/map/data';
import { buildingUrl } from '@/lib/map/types';
export const dynamic='force-dynamic';
const escape=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export async function GET() {
  const origin=process.env.NEXT_PUBLIC_SITE_URL||'https://911records.nyc';
  const rows=await buildingSitemapEntries();
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map(p=>`<url><loc>${escape(origin+buildingUrl(p))}</loc></url>`).join('')}</urlset>`;
  return new Response(xml,{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});
}
