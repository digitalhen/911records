import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSignatory, getOccurrences, relatedEntities, formatDate, entityHref, entityLinkHref, months, pageHref, TYPE_LABELS } from '@/lib/discovery/data';
import { Shell, Extraction, Caveat, Records, Section, metadata } from '@/components/discovery/Shared';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { MonthHistogram } from '@/components/ui';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic='force-dynamic';
type Params=Promise<{slug:string}>;
export async function generateMetadata({params}:{params:Params}) { const {slug}=await params; return metadata('Official role on records','Official capacity, actions and links to the source signature pages.',entityHref('signatory',slug)); }
export default async function Signatory({params}:{params:Params}) {
  const {slug}=await params;const row=await getSignatory(slug);if(!row)notFound();const rows=await getOccurrences(row.id,true);if(!rows.length)notFound();
  const related=await relatedEntities(rows);
  const source=rows[0]!;
  const filings=[...new Set(rows.map(r=>JSON.stringify([r.agency,r.volume,r.box,r.folder])))];
  const allMonths=[...new Set(rows.flatMap(r=>months(r.dates)))].sort();
  const activity=allMonths.map(month=>({month,rows:rows.filter(r=>months(r.dates).includes(month))}));
  const unknown=rows.filter(r=>!months(r.dates).length);
  const crumbs=breadcrumbJsonLd([{name:'Home',path:'/'},{name:'Entities',path:'/entities'},{name:'Officials acting on records',path:'/entities/signatory'},{name:row.title||row.name,path:entityHref('signatory',slug)}]);
  return <Shell title={row.name} eyebrow="Role → action → record">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
    <Link href="/entities">← Officials acting on records</Link>
    <p>{row.title || 'Official signatory'} · {row.org || 'Organization not recorded'}</p><Extraction source={source}/>
    <p>{formatDate(row.first_date) || 'Date unavailable'} – {formatDate(row.last_date) || 'date unavailable'}</p><Extraction source={source} confidence={null}/>
    <p className="quality">This person appears because of their official role on the records linked below. Appearance implies nothing about anyone. Actions describe the signature or routing block on a record.</p>
    <div className={styles.stats}><div><a href="#records"><strong>{new Set(rows.map(r=>r.doc)).size}</strong>documents</a><Extraction source={source} confidence={null}/></div><div><a href="#records"><strong>{new Set(rows.map(r=>`${r.doc}:${r.page}`)).size}</strong>signature pages</a><Extraction source={source} confidence={null}/></div><div><a href="#where"><strong>{filings.length}</strong>box / folder filings</a><Extraction source={source} confidence={null}/></div></div>
    <Caveat/>

    <Section id="overview" title="Overview">
      <MonthHistogram
        data={activity.map(a=>({month:a.month,count:new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size}))}
        ariaLabel="Signature pages by extracted month"
        caption="Distinct page counts by extracted month, not measurements."
        unit="page"
      />
      {activity.map(a=><details id={`month-${a.month}`} key={a.month}><summary>{a.month} · signature pages</summary>{a.rows.map(r=><p key={`${r.doc}:${r.page}:${r.role}`}><Link href={pageHref(r.doc,r.page)}>{r.title || r.doc} · page {r.page}</Link><Extraction source={r} confidence={null}/></p>)}</details>)}
      {unknown.length>0&&<details><summary>Undated source pages</summary>{unknown.map(r=><p key={`${r.doc}:${r.page}:${r.role}`}><Link href={pageHref(r.doc,r.page)}>{r.title || r.doc} · page {r.page}</Link><Extraction source={r} confidence={null}/></p>)}</details>}
      <Extraction source={source} confidence={null}/>
    </Section>

    <Records rows={rows} heading="Actions on the record"/>

    <Section id="where" title="Where it appears">
      <p className="small muted">Boxes, folders and agencies this official's signature pages are filed under. Folder labels are omitted to avoid surfacing personal names.</p>
      {filings.map((key,i)=>{const matches=rows.filter(r=>JSON.stringify([r.agency,r.volume,r.box,r.folder])===key);const r=matches[0]!;return <details key={key}><summary>{r.agency || 'Agency unavailable'} · Box {r.box || 'unavailable'} · Folder {i+1}</summary><p className="small muted">Volume {r.volume || 'unavailable'}.</p>{matches.map(m=><p key={`${m.doc}:${m.page}:${m.role}`}><Link href={pageHref(m.doc,m.page)}>{m.title || m.doc} · page {m.page}</Link><Extraction source={m}/></p>)}</details>})}
    </Section>

    {related.length>0&&<Section id="related" title="Related entities">
      <p className="small muted">Organizations, buildings and substances that co-occur on the same signature pages — never people. Ranked by shared pages.</p>
      <div className={styles.relatedGrid}>{related.map(r=><div key={r.id} className={styles.relatedItem}><Link href={entityLinkHref(r)}>{r.label}</Link><p className="small muted">{TYPE_LABELS[r.type] || r.type} · {r.shared_pages} shared {r.shared_pages===1?'page':'pages'}</p><small className="extraction">machine-extracted</small></div>)}</div>
    </Section>}
  </Shell>;
}
