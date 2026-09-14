import Link from 'next/link';
import { queryReadSafe } from '@/lib/db';
import { ENTITY_TYPES, pageHref, type Source } from '@/lib/discovery/data';
import { Extraction } from './Shared';
interface Related extends Source { cross:number;score:number; box:string|null;title:string|null;summary:string|null;shared_entities:number;shared_topics:number;same_box:boolean }
export async function RelatedRecords({doc}:{doc:string}) {
 let rows:Related[];
 try {rows=await queryReadSafe<Related>(`SELECT r.other AS doc,p.page,r.score,r.cross,d.box,d.title,d.summary,
   (SELECT COUNT(DISTINCT a.entity_id) FROM site.entity_pages a JOIN site.entity_pages b ON a.entity_id=b.entity_id
     JOIN site.entities e ON e.id=a.entity_id WHERE a.doc=r.doc AND b.doc=r.other AND e.type=ANY($2::text[])) AS shared_entities,
   (SELECT COUNT(DISTINCT a.topic) FROM site.doc_topics a JOIN site.doc_topics b USING(topic) WHERE a.doc=r.doc AND b.doc=r.other) AS shared_topics,
   (origin.box IS NOT NULL AND d.box=origin.box AND d.agency=origin.agency AND d.volume=origin.volume) AS same_box
   FROM site.related r JOIN site.documents origin ON origin.doc=r.doc JOIN site.documents d ON d.doc=r.other
   JOIN LATERAL (SELECT page FROM site.pages WHERE doc=d.doc ORDER BY page LIMIT 1) p ON true
   WHERE r.doc=$1 AND r.other<>r.doc AND origin.status IS DISTINCT FROM 'removed' AND d.status IS DISTINCT FROM 'removed'
     AND d.doc_type IS DISTINCT FROM 'cover_sheet'
   ORDER BY r.rank ASC NULLS LAST,r.score DESC,r.other LIMIT 12`,[doc,ENTITY_TYPES]);}
 catch{return <section className="discovery"><h2>Related records</h2><p>Related records are temporarily unavailable.</p></section>;}
 return <section className="discovery"><div className="section-head"><h2>Related records</h2><Link href="/topics">Browse subjects →</Link></div><p className="small muted">Ranked by indexed similarity. Reasons describe shared subjects and filing context; check the source records.</p><div className="discovery-grid">{[false,true].map(cross=><div key={String(cross)} className={cross?'elsewhere':undefined}><h3>{cross?'Filed elsewhere':'Same-box records'}</h3>{rows.filter(r=>Boolean(r.cross)===cross).map(r=><article className="result-item" key={r.doc}><Link href={pageHref(r.doc,r.page)}>{r.title||r.doc} · Box {r.box||'unavailable'}</Link>{r.title&&<p className="small muted mono">{r.doc}</p>}{r.summary&&<p className="small">{r.summary}</p>}<p className="small muted">{[Number(r.shared_entities)>0?`${r.shared_entities} shared non-person entities`:null,Number(r.shared_topics)>0?`${r.shared_topics} shared topics`:null,r.same_box?'Same agency, volume and box':null].filter(Boolean).join(' · ')||'Similar document embedding; no shared entity or topic indexed.'} · similarity {Number(r.score).toFixed(3)}</p><Extraction source={r} confidence={null}/></article>)}{!rows.some(r=>Boolean(r.cross)===cross)&&<p className="small muted">No available related records indexed in this group.</p>}</div>)}</div></section>;
}
export default RelatedRecords;
