import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getPlaceFile } from '@/lib/map/data';
import { buildingUrl, pageUrl } from '@/lib/map/types';
import RecordTable from '@/components/map/RecordTable';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { socialMeta } from '@/lib/seo/social';
import styles from '@/components/map/map.module.css';
export const dynamic = 'force-dynamic';
type Props={params:Promise<{bin:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {bin}=await params;
  const file=await getPlaceFile(bin);
  const title=file?`${file.place.label} · Building file`:'Building not found';
  const description='Source pages, test candidates and documents across all boxes for this building. Machine-extracted matches link to the record.';
  const path=file?buildingUrl(file.place):`/building/${encodeURIComponent(bin)}`;
  return {title,description,alternates:{canonical:path},...(!file?{robots:{index:false,follow:false}}:{}),...socialMeta(title,description,path)};
}
export default async function BuildingPage({params}:Props) {
  const {bin}=await params;const file=await getPlaceFile(bin);if(!file)notFound();
  const {place:p,rows,related}=file;
  const groups=new Map<string,Map<string,typeof rows[number]>>();
  for(const row of rows) {const key=`${row.agency||'Agency not recorded'} · Volume ${row.volume||'—'} · Box ${row.box||'—'}`;if(!groups.has(key))groups.set(key,new Map());groups.get(key)!.set(row.doc,row)}
  const crumbs=breadcrumbJsonLd([{name:'Home',path:'/'},{name:'Building map',path:'/map'},{name:p.label,path:buildingUrl(p)}]);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(crumbs)}}/><Header active="/map"/><main id="main" className={styles.building}>
    <div className="bread"><a href="/map">Building map</a><span>/ Building file</span></div>
    <div className="page-title"><div><div className="eyebrow">Building / all boxes</div><h1>{p.label}</h1><p className="subtitle">A building file, never a household profile.</p>
      <p className={styles.note}>Machine-extracted address · confidence {p.confidence?.toFixed(2)??'not available'} · <a href={pageUrl(p)}>verify source page</a></p></div><a className="button" href={`/?place=${encodeURIComponent(p.id)}`}>See on map →</a></div>
    <div className={styles.stats}><span><strong>{p.n_docs}</strong> records</span><span><strong>{p.n_pages}</strong> source pages</span><span><strong>{p.n_test_pages}</strong> test candidate pages</span><span>{p.first_date||'Date not extracted'} — {p.last_date||'date not extracted'}<small>Machine-extracted date span · <a href="#building-records">verify dated source rows</a></small></span></div>
    <section id="building-records"><h2>Samples, readings and decisions over time</h2><RecordTable rows={rows.filter(r=>r.has_test)}/></section>
    <section className={styles.section}><h2>Other pages / related memos</h2><p className={styles.note}>Pages mentioning this building without a test candidate. Memo and re-occupancy decisions are not classified in the index; read the page.</p>
      {rows.filter(r=>!r.has_test).map(r=><p className={styles.source} key={`${r.doc}:${r.page}`}><a href={pageUrl(r)}>{r.doc} · page {r.page}</a> · {r.dates.join(', ')||'Date not extracted'}<small>Machine-extracted · {r.inspection?'inspection candidate · ':''}confidence {r.confidence?.toFixed(2)??'not available'}</small></p>)}
      {!rows.some(r=>!r.has_test)&&<p>No other available source pages indexed.</p>}
    </section>
    <section className={styles.section}><h2>Documents by agency and box</h2>{[...groups].map(([key,docs])=><div className={styles.source} key={key}><h3>{key}</h3><ul>{[...docs.values()].map(r=><li key={r.doc}><a href={`/doc/${encodeURIComponent(r.doc)}`}>{r.doc}</a> · <a href={pageUrl(r)}>machine-extracted building match, page {r.page}</a></li>)}</ul></div>)}</section>
    <section className={styles.section}><h2>Related buildings on the same block</h2><p className={styles.note}>Block-lot keys and present-day footprint joins; not a reconstruction of 2001 buildings.</p>{related.length?<ul>{related.map(r=><li key={r.id}><a href={buildingUrl(r)}>{r.label}</a> · {r.n_docs} records · machine-extracted · <a href={pageUrl(r)}>verify</a></li>)}</ul>:<p>No same-block matches established by this place’s block-lot key or present-day footprint join.</p>}</section>
  </main><Footer/></>;
}
