import { discoverySitemapPaths } from '@/lib/discovery/sitemap';
export const dynamic='force-dynamic';
function xml(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
export async function GET(request:Request){
 const raw=new URL(request.url).searchParams.get('chunk')||'0';
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>100000)return new Response('Invalid chunk',{status:400});
 const origin=(process.env.NEXT_PUBLIC_SITE_URL||'https://911records.nyc').replace(/\/$/,'');
 const paths=await discoverySitemapPaths(Number(raw)*5000,5000);
 const entries=(Number(raw)===0?['/entities','/topics',...paths]:paths).map(path=>`<url><loc>${xml(origin+path)}</loc></url>`).join('\n');
 return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8'}});
}
