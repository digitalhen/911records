import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getPlaceFile, resolveBuildingRedirect } from '@/lib/map/data';
import { buildingUrl, decodeBldgClass, decodeId, pageUrl } from '@/lib/map/types';
import RecordTable from '@/components/map/RecordTable';
import { docTypeLabel } from '@/lib/docTypes';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { socialMeta } from '@/lib/seo/social';
import { ButtonLink, MonthHistogram } from '@/components/ui';
import { VegaChart } from '@/components/charts/VegaChart';
import { buildingTestsSpec } from '@/lib/charts/specs';
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
  const monthPages=new Map<string,Set<string>>();
  for(const r of rows) for(const d of r.dates) {const m=d.slice(0,7);if(!monthPages.has(m))monthPages.set(m,new Set());monthPages.get(m)!.add(`${r.doc}:${r.page}`)}
  const activity=[...monthPages.entries()].map(([month,pages])=>({month,count:pages.size}));
  const testsSpec=buildingTestsSpec(rows.filter(r=>r.has_test));
  // One row per document, grouped by document type (Henry, 2026-09-14: "some of the docs are
  // quality reports etc." — a per-page list hid what each document was). Cover sheets are the
  // folder's separator pages, not records, so they are left out here.
  type DocRow={doc:string;doc_type:string|null;title:string|null;summary:string|null;folder:string|null;box:string|null;agency:string|null;page_count:number|null;pages:number;firstPage:number;hasTest:boolean;dates:string[]};
  const byDoc=new Map<string,DocRow>();
  for(const r of rows){const d=byDoc.get(r.doc)||{doc:r.doc,doc_type:r.doc_type,title:r.title,summary:r.summary,folder:r.folder,box:r.box,agency:r.agency,page_count:r.page_count,pages:0,firstPage:r.page,hasTest:false,dates:[]};d.pages+=1;d.firstPage=Math.min(d.firstPage,r.page);d.hasTest=d.hasTest||r.has_test;d.dates.push(...r.dates);byDoc.set(r.doc,d)}
  const TYPE_ORDER=['lab_report','chain_of_custody','memo_letter','permit_application','form','sign_in_sheet','invoice','photo_log','other'];
  const typeGroups=new Map<string,DocRow[]>();
  for(const d of byDoc.values()){if(d.doc_type==='cover_sheet')continue;const k=d.doc_type&&TYPE_ORDER.includes(d.doc_type)?d.doc_type:'other';if(!typeGroups.has(k))typeGroups.set(k,[]);typeGroups.get(k)!.push(d)}
  const orderedTypes=TYPE_ORDER.filter(t=>typeGroups.has(t));
  const coverSheets=[...byDoc.values()].filter(d=>d.doc_type==='cover_sheet').length;
  const span=(ds:string[])=>{const s=[...ds].sort();return s.length?(s[0]===s[s.length-1]?s[0]:`${s[0]} – ${s[s.length-1]}`):null};
  const crumbs=breadcrumbJsonLd([{name:'Home',path:'/'},{name:'Building map',path:'/map'},{name:p.label,path:buildingUrl(p)}]);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(crumbs)}}/><Header active="/map"/><main id="main" className={styles.building}>
    <div className="bread"><a href="/map">Building map</a><span>/ Building file</span></div>
    <div className="page-title"><div><div className="eyebrow">Building / all boxes</div><h1>{p.label}</h1><p className="subtitle"></p>
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
    {activity.length>0 && <section className={styles.section} id="building-activity"><h2>Activity by month</h2>
      <MonthHistogram data={activity} ariaLabel="Source pages by extracted month" caption="Distinct page counts by extracted month, not measurements." unit="page"/>
    </section>}
    {testsSpec && <section className={styles.section} id="building-tests-over-time"><h2>Tests over time</h2>
      <p className={styles.note}>Each dot is a day on which a test candidate page names that substance for this building; bigger dots mean more pages that day. Dates and substances are machine-extracted from the page, and a dot is a page, not a result.</p>
      <VegaChart spec={testsSpec} width={820} label="Test candidate pages by substance and date"/>
    </section>}
    <section id="building-records"><h2>Samples, readings and decisions over time</h2><RecordTable rows={rows.filter(r=>r.has_test)}/></section>
    <section className={styles.section} id="building-documents"><h2>Documents for this building</h2>
      <p className={styles.note}>{byDoc.size-coverSheets} document{byDoc.size-coverSheets===1?'':'s'} across {new Set([...byDoc.values()].map(d=>`${d.agency}/${d.box}`)).size} box{new Set([...byDoc.values()].map(d=>`${d.agency}/${d.box}`)).size===1?'':'es'}, grouped by what each document is. Titles and summaries are machine-written; the page image is the authority.{coverSheets?` ${coverSheets} folder cover sheet${coverSheets===1?'':'s'} not listed.`:''}</p>
      {orderedTypes.map(t=><div key={t} className={styles.docGroup}><h3>{docTypeLabel(t)} <span className="muted">· {typeGroups.get(t)!.length}</span></h3>
        {typeGroups.get(t)!.sort((a,b)=>(span(a.dates)||'9999').localeCompare(span(b.dates)||'9999')||a.doc.localeCompare(b.doc)).map(d=><div className={styles.docRow} key={d.doc}>
          <a className={styles.docTitle} href={`/doc/${encodeURIComponent(d.doc)}`}>{d.title||(d.doc_type&&d.doc_type!=='other'?`Untitled ${(docTypeLabel(d.doc_type)||'document').toLowerCase()}`:'Unclassified document, no title yet')}</a>
          <span className="mono small muted">{d.doc}</span>
          {d.summary&&<p className="small">{d.summary}</p>}
          <small>{d.page_count??d.pages} page{(d.page_count??d.pages)===1?'':'s'} · {span(d.dates)||'no date extracted'} · {d.agency||'Agency not recorded'} · Box {d.box||'—'}{d.folder?` · folder “${d.folder.length>70?d.folder.slice(0,70).trim()+'…':d.folder}”`:''}{d.hasTest?' · test candidate pages':''} · <a href={pageUrl({doc:d.doc,page:d.firstPage})}>matched page {d.firstPage}</a></small>
        </div>)}
      </div>)}
      {!orderedTypes.length&&<p>No documents beyond folder cover sheets are indexed for this building yet.</p>}
    </section>
    <section className={styles.section}><h2>Related buildings on the same block</h2><p className={styles.note}>Block-lot keys and present-day footprint joins; not a reconstruction of 2001 buildings.</p>{related.length?<ul>{related.map(r=><li key={r.id}><a href={buildingUrl(r)}>{r.label}</a> · {r.n_docs} records · machine-extracted · <a href={pageUrl(r)}>verify</a></li>)}</ul>:<p>No same-block matches established by this place’s block-lot key or present-day footprint join.</p>}</section>
  </main><Footer/></>;
}
