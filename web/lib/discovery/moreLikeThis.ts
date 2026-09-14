import { INDEX } from '@/lib/opensearch';
import { queryReadSafe } from '@/lib/db';
import { documentsHaveTitles } from '@/lib/site';
import type { Source } from './data';
// The shared client keeps its transport private and omits vector from getIndexedPage.
// Match its environment/auth contract, requesting no OCR text or person fields.
async function request(path:string,body?:unknown):Promise<Record<string,unknown>> {
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(process.env.OPENSEARCH_USER) headers.Authorization=`Basic ${Buffer.from(`${process.env.OPENSEARCH_USER}:${process.env.OPENSEARCH_PASSWORD||''}`).toString('base64')}`;
  const response=await fetch(`${process.env.OPENSEARCH_URL||'http://127.0.0.1:9200'}/${encodeURIComponent(INDEX)}${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(4000),cache:'no-store'});
  if(!response.ok)throw new Error('Similarity index unavailable');return response.json();
}
export interface MoreLikeHit extends Source { score: number; title: string | null; summary: string | null; box: string | null }

export async function moreLikeThis(doc:string,page:number):Promise<{hits:MoreLikeHit[];unavailable:boolean}> {
 try {
  const allowed=await queryReadSafe(`SELECT p.doc FROM site.pages p JOIN site.documents d USING(doc) WHERE p.doc=$1 AND p.page=$2 AND d.status IS DISTINCT FROM 'removed'`,[doc,page]);
  if(!allowed.length)return {hits:[],unavailable:false};
  const source=await request(`/_doc/${encodeURIComponent(`${doc}_p${page}`)}?_source_includes=vector`);
  const vector=(source._source as {vector?:unknown}|undefined)?.vector;
  if(!Array.isArray(vector)||!vector.length||!vector.every(v=>typeof v==='number'&&Number.isFinite(v)))return {hits:[],unavailable:true};
  const result=await request('/_search',{size:30,_source:['doc','page'],query:{knn:{vector:{vector,k:50,filter:{bool:{must_not:[{term:{doc}}]}}}}}});
  const hits=((result.hits as {hits?:{_source?:{doc?:string;page?:number};_score?:number}[]}|undefined)?.hits||[])
    .flatMap(h=>h._source?.doc&&Number.isInteger(h._source.page)&&h._source.page!>0&&Number.isFinite(h._score)?[{doc:h._source.doc,page:h._source.page!,score:h._score!,confidence:null}]:[]).filter(h=>h.doc!==doc);
  if(!hits.length)return {hits:[],unavailable:false};
  // Postgres is authoritative for removals; never trust stale index status. Schema-first (issue
  // #37): title/summary read by name, gated on documentsHaveTitles() like every other explicit
  // site.documents.title/summary reference — see that function's comment in lib/site.ts.
  const withTitles=await documentsHaveTitles();
  const titleCols=withTitles?'d.title,d.summary,':'NULL::text AS title,NULL::text AS summary,';
  const visible=await queryReadSafe<{doc:string;page:number;box:string|null;title:string|null;summary:string|null}>(`SELECT p.doc,p.page,d.box,${titleCols}
    FROM site.pages p JOIN site.documents d USING(doc)
    WHERE p.doc=ANY($1::text[]) AND d.status IS DISTINCT FROM 'removed'`,[[...new Set(hits.map(h=>h.doc))]]);
  const byKey=new Map(visible.map(v=>[`${v.doc}:${v.page}`,v]));
  return {hits:hits.flatMap(h=>{const v=byKey.get(`${h.doc}:${h.page}`);return v?[{...h,box:v.box,title:v.title,summary:v.summary}]:[];}).slice(0,6),unavailable:false};
 }catch{return {hits:[],unavailable:true};}
}
