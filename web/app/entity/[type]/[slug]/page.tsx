import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEntity, getOccurrences, formatDate, entityHref, months, pageHref } from '@/lib/discovery/data';
import { Shell, Extraction, Caveat, Records, metadata } from '@/components/discovery/Shared';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic = 'force-dynamic';
type Params = Promise<{type:string;slug:string}>;
export async function generateMetadata({params}:{params:Params}) { const {type,slug}=await params; const entity=await getEntity(type,slug); const rows=entity?await getOccurrences(entity.id):[]; return metadata(rows.length?`${entity!.label} · ${type}`:'Entity records','Machine-extracted roles and source pages in the City’s released records.',entityHref(type,slug)); }
export default async function EntityPage({params}:{params:Params}) {
  const {type,slug}=await params; const entity=await getEntity(type,slug); if(!entity) notFound();
  const rows=await getOccurrences(entity.id); if(!rows.length) notFound();
  const source=rows[0]!;
  const filings=[...new Set(rows.map(r=>JSON.stringify([r.agency,r.volume,r.box,r.folder])))];
  const allMonths=[...new Set(rows.flatMap(r=>months(r.dates)))].sort();
  const activity=allMonths.map(month=>({month,rows:rows.filter(r=>months(r.dates).includes(month))}));
  const unknown=rows.filter(r=>!months(r.dates).length);
  const max=Math.max(1,...activity.map(a=>new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size));
  return <Shell title={entity.label} eyebrow="Entity / role on the source record"><Link href="/entities">← Change entity</Link><p>{type} · {formatDate(entity.first_date) || 'Date unavailable'} – {formatDate(entity.last_date) || 'date unavailable'}</p><Extraction source={source} confidence={null}/><Caveat/>
    <div className={styles.stats}><div><a href="#records"><strong>{new Set(rows.map(r=>r.doc)).size}</strong>documents</a><Extraction source={source} confidence={null}/></div><div><a href="#records"><strong>{new Set(rows.map(r=>`${r.doc}:${r.page}`)).size}</strong>source pages</a><Extraction source={source} confidence={null}/></div><div><a href="#filings"><strong>{filings.length}</strong>box / folder filings</a><Extraction source={source} confidence={null}/></div></div>
    <div className={styles.grid}><section><h2>Activity over time</h2><p className="small muted">Distinct page counts by extracted month, not measurements. A page may carry several dates. Coverage is limited to dates on indexed place pages.</p>{activity.length>0&&<svg className={styles.histogram} viewBox={`0 0 640 ${activity.length*32}`} role="img" aria-label="Source pages by extracted month">{activity.map((a,i)=><a key={a.month} href={`#month-${a.month}`}><title>{a.month}: {new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size} pages</title><text x="0" y={i*32+20} fontSize="12">{a.month}</text><rect x="80" y={i*32+4} width={500*new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size/max} height="23" fill="#dfe7f1"/><text x="600" y={i*32+20} fontSize="12">{new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size}</text></a>)}</svg>}
    {activity.map(a=><details id={`month-${a.month}`} key={a.month}><summary>{a.month} · source pages</summary>{a.rows.map(r=><p key={`${r.doc}:${r.page}:${r.role}`}><Link href={pageHref(r.doc,r.page)}>{r.doc} · page {r.page}</Link><Extraction source={r} confidence={null}/></p>)}</details>)}{unknown.length>0&&<details><summary>Undated source pages</summary>{unknown.map(r=><p key={`${r.doc}:${r.page}:${r.role}`}><Link href={pageHref(r.doc,r.page)}>{r.doc} · page {r.page}</Link><Extraction source={r} confidence={null}/></p>)}</details>}<Extraction source={source} confidence={null}/></section>
    <aside id="filings"><h2>Where it is filed</h2>{filings.map((key,i)=>{const matches=rows.filter(r=>JSON.stringify([r.agency,r.volume,r.box,r.folder])===key);const r=matches[0]!;return <details key={key}><summary>{r.agency || 'Agency unavailable'} · Box {r.box || 'unavailable'} · Folder {i+1}</summary><p className="small muted">Volume {r.volume || 'unavailable'}. Folder labels are omitted here to avoid surfacing personal names.</p>{matches.map(m=><p key={`${m.doc}:${m.page}:${m.role}`}><Link href={pageHref(m.doc,m.page)}>{m.doc} · page {m.page}</Link><Extraction source={m}/></p>)}</details>})}</aside></div><Records rows={rows}/></Shell>;
}
