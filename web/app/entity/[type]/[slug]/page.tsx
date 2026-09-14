import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEntity, getOccurrences, relatedEntities, formatDate, entityHref, entityLinkHref, distribution, months, pageHref, TYPE_LABELS } from '@/lib/discovery/data';
import { Shell, Extraction, Caveat, Records, Section, metadata } from '@/components/discovery/Shared';
import { getPlaceFile } from '@/lib/map/data';
import { buildingUrl, decodeBldgClass } from '@/lib/map/types';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic = 'force-dynamic';
type Params = Promise<{type:string;slug:string}>;
export async function generateMetadata({params}:{params:Params}) { const {type,slug}=await params; const entity=await getEntity(type,slug); const rows=entity?await getOccurrences(entity.id):[]; return metadata(rows.length?`${entity!.label} · ${type}`:'Entity records','Machine-extracted roles and source pages in the City’s released records.',entityHref(type,slug)); }
export default async function EntityPage({params}:{params:Params}) {
  const {type,slug}=await params; const entity=await getEntity(type,slug); if(!entity) notFound();
  const rows=await getOccurrences(entity.id); if(!rows.length) notFound();
  const source=rows[0]!;
  // The roll match (entity.bin/bbl) does not guarantee a building page has records of its own —
  // only link when one actually resolves, so this never points at a 404 (issue #25's rule).
  const buildingId = entity.bin ? `bin:${entity.bin}` : entity.bbl ? `bbl:${entity.bbl}` : null;
  const [related, buildingFile]=await Promise.all([
    relatedEntities(rows,entity.id),
    type==='address' && buildingId ? getPlaceFile(buildingId) : Promise.resolve(null),
  ]);
  const buildingHref = buildingFile ? buildingUrl(buildingFile.place) : null;
  const facts = buildingFile?.facts;
  const filings=[...new Set(rows.map(r=>JSON.stringify([r.agency,r.volume,r.box,r.folder])))];
  const allMonths=[...new Set(rows.flatMap(r=>months(r.dates)))].sort();
  const activity=allMonths.map(month=>({month,rows:rows.filter(r=>months(r.dates).includes(month))}));
  const unknown=rows.filter(r=>!months(r.dates).length);
  const max=Math.max(1,...activity.map(a=>new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size));
  const variants=distribution(entity.variants).filter(([spelling])=>spelling.trim().toLowerCase()!==entity.label.trim().toLowerCase());
  const crumbs = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Entities', path: '/entities' },
    { name: TYPE_LABELS[type] || type, path: `/entities/${type}` },
    { name: entity.label, path: entityHref(type, slug) },
  ]);
  return <Shell title={entity.label} eyebrow={`${TYPE_LABELS[type] || type} · role on the source record`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} /><Link href="/entities">← Change entity</Link><p>{formatDate(entity.first_date) || 'Date unavailable'} – {formatDate(entity.last_date) || 'date unavailable'}</p><Extraction source={source} confidence={null}/><Caveat/>
    <div className={styles.stats}><div><a href="#records"><strong>{new Set(rows.map(r=>r.doc)).size}</strong>documents</a><Extraction source={source} confidence={null}/></div><div><a href="#records"><strong>{new Set(rows.map(r=>`${r.doc}:${r.page}`)).size}</strong>source pages</a><Extraction source={source} confidence={null}/></div><div><a href="#where"><strong>{filings.length}</strong>box / folder filings</a><Extraction source={source} confidence={null}/></div></div>

    <Section id="overview" title="Overview">
      <p className="small muted">Distinct page counts by extracted month, not measurements. A page may carry several dates. Coverage is limited to dates on indexed place pages.</p>
      {activity.length>0&&<svg className={styles.histogram} viewBox={`0 0 640 ${activity.length*32}`} role="img" aria-label="Source pages by extracted month">{activity.map((a,i)=><a key={a.month} href={`#month-${a.month}`} aria-label={`${a.month}: ${new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size} pages`}><text x="0" y={i*32+20} fontSize="12">{a.month}</text><rect x="80" y={i*32+4} width={500*new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size/max} height="23" fill="#dfe7f1"/><text x="600" y={i*32+20} fontSize="12">{new Set(a.rows.map(r=>`${r.doc}:${r.page}`)).size}</text></a>)}</svg>}
      {activity.map(a=><details id={`month-${a.month}`} key={a.month}><summary>{a.month} · source pages</summary>{a.rows.map(r=><p key={`${r.doc}:${r.page}:${r.role}`}><Link href={pageHref(r.doc,r.page)}>{r.title || r.doc} · page {r.page}</Link><Extraction source={r} confidence={null}/></p>)}</details>)}
      {unknown.length>0&&<details><summary>Undated source pages</summary>{unknown.map(r=><p key={`${r.doc}:${r.page}:${r.role}`}><Link href={pageHref(r.doc,r.page)}>{r.title || r.doc} · page {r.page}</Link><Extraction source={r} confidence={null}/></p>)}</details>}
      {variants.length>0&&<><h3>Also read as</h3><p className="small muted">Alternate spellings machine-read from the scans, folded into this one canonical entity.</p><div className={styles.variants}>{variants.map(([spelling,count])=><span key={spelling}>{spelling} · {count}×</span>)}</div></>}
      <Extraction source={source} confidence={null}/>
    </Section>

    <Records rows={rows}/>

    <Section id="where" title="Where it appears">
      <p className="small muted">Boxes, folders and agencies this entity's source pages are filed under. Folder labels are omitted to avoid surfacing personal names.</p>
      {filings.map((key,i)=>{const matches=rows.filter(r=>JSON.stringify([r.agency,r.volume,r.box,r.folder])===key);const r=matches[0]!;return <details key={key}><summary>{r.agency || 'Agency unavailable'} · Box {r.box || 'unavailable'} · Folder {i+1}</summary><p className="small muted">Volume {r.volume || 'unavailable'}.</p>{matches.map(m=><p key={`${m.doc}:${m.page}:${m.role}`}><Link href={pageHref(m.doc,m.page)}>{m.title || m.doc} · page {m.page}</Link><Extraction source={m}/></p>)}</details>})}
    </Section>

    {related.length>0&&<Section id="related" title="Related entities">
      <p className="small muted">Organizations, buildings and substances that co-occur with {entity.label} on the same source pages — never people. Ranked by shared pages.</p>
      <div className={styles.relatedGrid}>{related.map(r=><div key={r.id} className={styles.relatedItem}><Link href={entityLinkHref(r)}>{r.label}</Link><p className="small muted">{TYPE_LABELS[r.type] || r.type} · {r.shared_pages} shared {r.shared_pages===1?'page':'pages'}</p><small className="extraction">machine-extracted</small></div>)}</div>
    </Section>}

    {/* Only when a building page actually resolves — entity.bin/bbl (Prospect gazetteer match)
        doesn't guarantee a site.places row exists (that's a separate extraction pass, #25). */}
    {type==='address' && buildingFile && buildingHref && <Section id="building" title="Building file">
      <div className={styles.buildingPanel}>
        <h3>{buildingFile.place.label}</h3>
        <p className="small muted">{entity.bin?`BIN ${entity.bin}`:`BBL ${entity.bbl}`}{entity.bin && entity.bbl?` · BBL ${entity.bbl}`:''} · matched through the Prospect property-roll gazetteer (docs/PLAN.md).</p>
        <div className={styles.buildingFacts}>
          <div><strong>{buildingFile.place.n_docs}</strong><span>records</span></div>
          <div><strong>{buildingFile.place.n_pages}</strong><span>source pages</span></div>
          <div><strong>{buildingFile.place.n_test_pages}</strong><span>test candidate pages</span></div>
          <div><strong>{buildingFile.place.first_date||'—'}</strong><span>{buildingFile.place.first_date?`through ${buildingFile.place.last_date||'—'}`:'no dated pages'}</span></div>
        </div>
        {facts && <dl className={styles.buildingDetails}>
          {facts.year_built!=null && <div><dt>Year built</dt><dd>{facts.year_built}</dd></div>}
          {facts.num_floors!=null && <div><dt>Floors</dt><dd>{facts.num_floors}</dd></div>}
          {(facts.units_res!=null||facts.units_total!=null) && <div><dt>Units</dt><dd>{facts.units_res??'—'} residential / {facts.units_total??'—'} total</dd></div>}
          {facts.bldg_area!=null && <div><dt>Building area</dt><dd>{Number(facts.bldg_area).toLocaleString()} sq ft</dd></div>}
          {facts.bldg_class && <div><dt>Building class</dt><dd>{decodeBldgClass(facts.bldg_class)}</dd></div>}
        </dl>}
        {facts && <p className="small muted">Present-day building details · provided by <a href="https://prospect.nyc">prospect.nyc</a>. Describes the lot today, not in 2001 — never owner names, unit lists or sales.</p>}
        <Link className="button primary" href={buildingHref}>Open the building file →</Link>
      </div>
    </Section>}
  </Shell>;
}
