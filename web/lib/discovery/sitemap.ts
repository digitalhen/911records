import { queryReadSafe } from '@/lib/db';
import { ENTITY_TYPES } from './data';
// Coordinator hook: append these entries to the sitemap index; see NOTES-B4.md.
export async function discoverySitemapPaths(offset=0,limit=5000):Promise<string[]> {
 const rows=await queryReadSafe<{path:string}>(`SELECT path FROM (
 SELECT '/entity/' || e.type || '/' || e.slug AS path FROM site.entities e
 WHERE e.type=ANY($1::text[]) AND EXISTS(SELECT 1 FROM site.entity_pages ep JOIN site.documents d USING(doc)
 JOIN site.pages p USING(doc,page) WHERE ep.entity_id=e.id AND d.status IS DISTINCT FROM 'removed')
 UNION ALL SELECT '/topics/' || t.id::text FROM site.topics t WHERE EXISTS(SELECT 1 FROM site.doc_topics dt JOIN site.documents d USING(doc)
 JOIN site.pages p USING(doc) WHERE dt.topic=t.id AND d.status IS DISTINCT FROM 'removed')
 UNION ALL SELECT '/signatory/' || s.slug FROM site.signatories s WHERE EXISTS(SELECT 1 FROM site.signatory_pages sp JOIN site.documents d USING(doc)
 JOIN site.pages p USING(doc,page) WHERE sp.id=s.id AND d.status IS DISTINCT FROM 'removed')
 ) urls ORDER BY path LIMIT $2 OFFSET $3`,[ENTITY_TYPES,Math.min(5000,Math.max(1,limit)),Math.max(0,offset)]);
 return rows.map(r=>r.path.split('/').map(encodeURIComponent).join('/'));
}
export async function discoverySitemapCount():Promise<number>{
 // Avoid a second eligibility query contract; page until exhausted.
 let count=0;
 for(;;){const paths=await discoverySitemapPaths(count,5000);count+=paths.length;if(paths.length<5000)return count;}
}
