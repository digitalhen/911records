import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEntity, getEntitySummary, getOccurrencesPage, getEntityFilings, relatedEntitiesFor, ENTITY_PAGE_SIZE, formatDate, entityHref, entityLinkHref, distribution, pageHref, TYPE_LABELS } from '@/lib/discovery/data';
import { Shell, Extraction, Caveat, Section, metadata } from '@/components/discovery/Shared';
import { getPlaceFile } from '@/lib/map/data';
import { buildingUrl, decodeBldgClass } from '@/lib/map/types';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import { MonthHistogram } from '@/components/ui';
import { VegaChart } from '@/components/charts/VegaChart';
import { monthsByAgencySpec } from '@/lib/charts/specs';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic = 'force-dynamic';
type Params = Promise<{type:string;slug:string}>;
type Search = Promise<{[k:string]:string|string[]|undefined}>;
const num = (v: string|string[]|undefined) => { const n = Math.floor(Number(Array.isArray(v) ? v[0] : v)); return Number.isFinite(n) && n > 0 ? n : 1; };
export async function generateMetadata({params}:{params:Params}) { const {type,slug}=await params; const entity=await getEntity(type,slug); const sum=entity?await getEntitySummary(entity.id):null; return metadata(sum?.pages?`${entity!.label} · ${type}`:'Entity records','Machine-extracted roles and source pages in the City’s released records.',entityHref(type,slug)); }
/** Server-rendered "Previous / Next" links; each list has its own query parameter so they page independently. */
function Pager({ params, param, page, total, anchor }: { params: Record<string,string>; param: string; page: number; total: number; anchor: string }) {
  const pages = Math.ceil(total / ENTITY_PAGE_SIZE); if (pages <= 1) return null;
  const href = (n: number) => { const q = new URLSearchParams(params); if (n > 1) q.set(param, String(n)); else q.delete(param); const s = q.toString(); return `?${s}#${anchor}`; };
  const first = (page - 1) * ENTITY_PAGE_SIZE + 1, last = Math.min(total, page * ENTITY_PAGE_SIZE);
  return <nav className="small muted" aria-label="Pagination">{page > 1 && <><Link href={href(page - 1)} rel="prev" scroll={false}>← Previous</Link>{' · '}</>}Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()} (page {page.toLocaleString()} of {pages.toLocaleString()}){page < pages && <>{' · '}<Link href={href(page + 1)} rel="next" scroll={false}>Next →</Link></>}</nav>;
}
export default async function EntityPage({params,searchParams}:{params:Params;searchParams:Search}) {
  const {type,slug}=await params; const sp=await searchParams; const entity=await getEntity(type,slug); if(!entity) notFound();
  const sum=await getEntitySummary(entity.id); if(!sum.pages||!sum.source) notFound();
  const source=sum.source;
  // ?role=N filters the document list to one role (1-based, in the order of the role headings).
  const roleN=sp.role===undefined?0:num(sp.role); const activeRole=roleN>0?sum.roles[roleN-1]??null:null;
  const recTotal=activeRole?activeRole.pages:sum.pages;
  const recPage=Math.min(num(sp.page),Math.max(1,Math.ceil(recTotal/ENTITY_PAGE_SIZE)));
  const filPage=Math.min(num(sp.filings),Math.max(1,Math.ceil(sum.filings/ENTITY_PAGE_SIZE)));
  const keep: Record<string,string> = {}; if(activeRole) keep.role=String(roleN);
  const recParams={...keep, ...(filPage>1?{filings:String(filPage)}:{})}; const filParams={...keep, ...(recPage>1?{page:String(recPage)}:{})};
  // The roll match (entity.bin/bbl) does not guarantee a building page has records of its own —
  // only link when one actually resolves, so this never points at a 404 (issue #25's rule).
  const buildingId = entity.bin ? `bin:${entity.bin}` : entity.bbl ? `bbl:${entity.bbl}` : null;
  const [rows, filings, related, buildingFile]=await Promise.all([
    getOccurrencesPage(entity.id,(recPage-1)*ENTITY_PAGE_SIZE,activeRole?.role??null),
    getEntityFilings(entity.id,(filPage-1)*ENTITY_PAGE_SIZE),
    relatedEntitiesFor(entity.id),
    type==='address' && buildingId ? getPlaceFile(buildingId) : Promise.resolve(null),
  ]);
  const buildingHref = buildingFile ? buildingUrl(buildingFile.place) : null;
  const facts = buildingFile?.facts;
  const agencySpec=new Set(sum.agencyMonths.map(c=>c.agency)).size>1?monthsByAgencySpec(sum.agencyMonths):null;
  const variants=distribution(entity.variants).filter(([spelling])=>spelling.trim().toLowerCase()!==entity.label.trim().toLowerCase());
  const crumbs = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Entities', path: '/entities' },
    { name: TYPE_LABELS[type] || type, path: `/entities/${type}` },
    { name: entity.label, path: entityHref(type, slug) },
  ]);
  const rolesShown=[...new Set(rows.map(r=>r.role))];
  return <Shell title={entity.label} eyebrow={`${TYPE_LABELS[type] || type} · role on the source record`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} /><Link href="/entities">← Change entity</Link><p>{formatDate(entity.first_date) || 'Date unavailable'} – {formatDate(entity.last_date) || 'date unavailable'}</p><Extraction source={source} confidence={null}/><Caveat/>
    <div className={styles.stats}><div><a href="#records"><strong>{sum.docs.toLocaleString()}</strong>documents</a><Extraction source={source} confidence={null}/></div><div><a href="#records"><strong>{sum.pages.toLocaleString()}</strong>source pages</a><Extraction source={source} confidence={null}/></div><div><a href="#where"><strong>{sum.filings.toLocaleString()}</strong>box / folder filings</a><Extraction source={source} confidence={null}/></div></div>

    <Section id="overview" title="Overview">
      <MonthHistogram
        data={sum.months.map(a=>({month:a.month,count:a.pages}))}
        ariaLabel="Source pages by extracted month"
        caption="Distinct page counts by extracted month, not measurements."
        unit="page"
      />
      {agencySpec && <VegaChart spec={agencySpec} width={820} label="Source pages per month by agency" caption="The same pages by the agency whose files they were found in."/>}
      {sum.topDocs.length>0&&<><h3>Documents with the most pages</h3><ul>{sum.topDocs.map(d=><li key={d.doc}><Link href={pageHref(d.doc,1)}>{d.title || d.doc}</Link> · {d.pages.toLocaleString()} {d.pages===1?'page':'pages'}</li>)}</ul></>}
      {variants.length>0&&<><h3>Also read as</h3><p className="small muted">Alternate spellings machine-read from the scans, folded into this one canonical entity.</p><div className={styles.variants}>{variants.map(([spelling,count])=><span key={spelling}>{spelling} · {count}×</span>)}</div></>}
      <Extraction source={source} confidence={null}/>
    </Section>

    <Section id="records" title="Documents grouped by role">
      {sum.roles.length>1&&<p className="small muted">Roles: {sum.roles.map((r,i)=><span key={r.role}>{i>0&&' · '}<Link href={`?${new URLSearchParams({role:String(i+1)}).toString()}#records`} scroll={false}>{r.role} ({r.pages.toLocaleString()})</Link></span>)}{activeRole&&<> · <Link href="?#records" scroll={false}>All roles</Link></>}</p>}
      {rolesShown.map(role=>{const i=sum.roles.findIndex(r=>r.role===role);const info=sum.roles[i];return <section key={role} id={`role-${i}`}><h3>{role} · <a href={`#role-${i}`}>{(info?.docs??0).toLocaleString()} documents</a></h3>{rows.filter(r=>r.role===role).map(r=><article className="result-item" key={`${r.doc}:${r.page}:${r.confidence}`}><Link href={pageHref(r.doc,r.page)}>{r.title || r.doc} · page {r.page}</Link>{r.title && <p className="small muted mono">{r.doc}</p>}{r.summary && <p className="small">{r.summary}</p>}<p className="small muted">{r.agency || 'Agency not recorded'} · Box {r.box || 'not recorded'}</p><Extraction source={r}/></article>)}</section>})}
      <Pager params={recParams} param="page" page={recPage} total={recTotal} anchor="records"/>
    </Section>

    <Section id="where" title="Where it appears">
      <p className="small muted">Boxes, folders and agencies this entity's source pages are filed under, largest first. Folder labels are omitted to avoid surfacing personal names.</p>
      {filings.map((f,i)=><p key={`${f.agency}|${f.volume}|${f.box}|${f.folder}`}><Link href={pageHref(f.doc,f.page)}>{f.agency || 'Agency unavailable'} · Box {f.box || 'unavailable'} · Folder {(filPage-1)*ENTITY_PAGE_SIZE+i+1}</Link> <span className="small muted">Volume {f.volume || 'unavailable'} · {f.pages.toLocaleString()} {f.pages===1?'source page':'source pages'}</span></p>)}
      <Pager params={filParams} param="filings" page={filPage} total={sum.filings} anchor="where"/>
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
