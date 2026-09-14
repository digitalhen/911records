import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getPlaceFile, resolveBuildingRedirect } from '@/lib/map/data';
import { buildingUrl, decodeBldgClass, decodeId, pageUrl } from '@/lib/map/types';
import RecordTable from '@/components/map/RecordTable';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { socialMeta } from '@/lib/seo/social';
import { ButtonLink } from '@/components/ui';
import styles from '@/components/map/map.module.css';
export const dynamic = 'force-dynamic';
type Props={params:Promise<{id:string}>};
// Canonical URL for a place: its own encoded id, or — when a bbl:/address: place resolves to a
// present-day BIN that itself has indexed records — that BIN's bare-number building page (#25).
async function canonicalPath(rawId: string) {
  const decoded = decodeId(rawId);
  if (decoded.length > 200) return { decoded, file: null, path: null };
  const file = await getPlaceFile(decoded);
  if (!file) return { decoded, file: null, path: null };
  const bin = file.place.kind !== 'bin' ? await resolveBuildingRedirect(file.place) : null;
  const path = bin ? `/building/${bin}` : buildingUrl(file.place);
  return { decoded, file, path };
}
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {id}=await params;
  const {file,path}=await canonicalPath(id);
  const title=file?`${file.place.label} · Building file`:'Building not found';
  const description='Source pages, test candidates and documents across all boxes for this building. Machine-extracted matches link to the record.';
  const canonical=path||`/building/${encodeURIComponent(decodeId(id))}`;
  return {title,description,alternates:{canonical},...(!file?{robots:{index:false,follow:false}}:{}),...socialMeta(title,description,canonical)};
}
export default async function BuildingPage({params}:Props) {
  const {id}=await params;
  const {decoded,file,path}=await canonicalPath(id);
  if(!file)notFound();
  const requestedPath=`/building/${id}`;
  if(path && path!==requestedPath && path!==`/building/${encodeURIComponent(decoded)}`)permanentRedirect(path);
  const {place:p,rows,related,facts}=file;
  const groups=new Map<string,Map<string,typeof rows[number]>>();
  for(const row of rows) {const key=`${row.agency||'Agency not recorded'} · Volume ${row.volume||'—'} · Box ${row.box||'—'}`;if(!groups.has(key))groups.set(key,new Map());groups.get(key)!.set(row.doc,row)}
  const crumbs=breadcrumbJsonLd([{name:'Home',path:'/'},{name:'Building map',path:'/map'},{name:p.label,path:buildingUrl(p)}]);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(crumbs)}}/><Header active="/map"/><main id="main" className={styles.building}>
    <div className="bread"><a href="/map">Building map</a><span>/ Building file</span></div>
    <div className="page-title"><div><div className="eyebrow">Building / all boxes</div><h1>{p.label}</h1><p className="subtitle">A building file, never a household profile.</p>
      <p className={styles.note}>Machine-extracted address · confidence {p.confidence?.toFixed(2)??'not available'} · <a href={pageUrl(p)}>verify source page</a></p></div><ButtonLink variant="secondary" href={`/?place=${encodeURIComponent(p.id)}`}>See on map →</ButtonLink></div>
    <div className={styles.stats}><span><strong>{p.n_docs}</strong> records</span><span><strong>{p.n_pages}</strong> source pages</span><span><strong>{p.n_test_pages}</strong> test candidate pages</span><span>{p.first_date||'Date not extracted'} — {p.last_date||'date not extracted'}<small>Machine-extracted date span · <a href="#building-records">verify dated source rows</a></small></span></div>
    {facts && <section className={styles.section} id="building-details"><h2>Building details</h2>
      <dl className={styles.facts}>
        {facts.year_built!=null && <div><dt>Year built</dt><dd>{facts.year_built}</dd></div>}
        {facts.num_floors!=null && <div><dt>Floors</dt><dd>{facts.num_floors}</dd></div>}
        {(facts.units_res!=null||facts.units_total!=null) && <div><dt>Units</dt><dd>{facts.units_res??'—'} residential / {facts.units_total??'—'} total</dd></div>}
        {facts.bldg_area!=null && <div><dt>Building area</dt><dd>{Number(facts.bldg_area).toLocaleString()} sq ft</dd></div>}
        {facts.bldg_class && <div><dt>Building class</dt><dd>{decodeBldgClass(facts.bldg_class)}</dd></div>}
        {facts.num_bldgs!=null && <div><dt>Buildings on lot</dt><dd>{facts.num_bldgs}</dd></div>}
      </dl>
      <p className={styles.note}>Present-day data · provided by <a href="https://prospect.nyc">prospect.nyc</a>. These figures describe the lot today, not in 2001 — building facts only, never owner names, unit lists or sales.</p>
    </section>}
    <section id="building-records"><h2>Samples, readings and decisions over time</h2><RecordTable rows={rows.filter(r=>r.has_test)}/></section>
    <section className={styles.section}><h2>Other pages / related memos</h2><p className={styles.note}>Pages mentioning this building without a test candidate. Memo and re-occupancy decisions are not classified in the index; read the page.</p>
      {rows.filter(r=>!r.has_test).map(r=><p className={styles.source} key={`${r.doc}:${r.page}`}><a href={pageUrl(r)}>{r.doc} · page {r.page}</a> · {r.dates.join(', ')||'Date not extracted'}<small>Machine-extracted · {r.inspection?'inspection candidate · ':''}confidence {r.confidence?.toFixed(2)??'not available'}</small></p>)}
      {!rows.some(r=>!r.has_test)&&<p>No other available source pages indexed.</p>}
    </section>
    <section className={styles.section}><h2>Documents by agency and box</h2>{[...groups].map(([key,docs])=><div className={styles.source} key={key}><h3>{key}</h3><ul>{[...docs.values()].map(r=><li key={r.doc}><a href={`/doc/${encodeURIComponent(r.doc)}`}>{r.doc}</a> · <a href={pageUrl(r)}>machine-extracted building match, page {r.page}</a></li>)}</ul></div>)}</section>
    <section className={styles.section}><h2>Related buildings on the same block</h2><p className={styles.note}>Block-lot keys and present-day footprint joins; not a reconstruction of 2001 buildings.</p>{related.length?<ul>{related.map(r=><li key={r.id}><a href={buildingUrl(r)}>{r.label}</a> · {r.n_docs} records · machine-extracted · <a href={pageUrl(r)}>verify</a></li>)}</ul>:<p>No same-block matches established by this place’s block-lot key or present-day footprint join.</p>}</section>
  </main><Footer/></>;
}
