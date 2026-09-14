import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { queryReadSafe } from '@/lib/db';
import { getDocument, getPagesForDoc, type DocumentRow } from '@/lib/site';
import { pageImagePath } from '@/lib/files';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { pageHref } from '@/lib/discovery/data';
import { Shell, Extraction, metadata } from './Shared';
import styles from './discovery.module.css';
type Params=Promise<{doc:string}>;
export async function generateMetadata({params}:{params:Params}) {
 const {doc}=await params;return metadata(`Copies and versions · ${doc}`,'Compare near-duplicate records and their filing locations. Similar copies are not independent tests.',`/doc/${encodeURIComponent(doc)}/versions`);
}
async function Frame({record,page,label}:{record:DocumentRow;page:number;label:string}) {
 if(record.status==='removed')return <section className={styles.frame}><h2>{label}</h2><Link href={`/doc/${encodeURIComponent(record.doc)}`}>{record.doc} · removed by the City</Link></section>;
 const pages=await getPagesForDoc(record.doc);const selected=pages.find(p=>p.page===page);
 return <section className={styles.frame}><h2>{label}</h2><Link href={pageHref(record.doc,selected?.page||1)}>{record.title||record.doc}</Link>{record.title&&<p className="small muted mono">{record.doc}</p>}{record.summary&&<p className="small">{record.summary}</p>}<p className="small muted">{record.agency||'Agency unavailable'} · Volume {record.volume||'unavailable'} · Box {record.box||'unavailable'}</p><p className="small muted">Open the record for the City’s folder metadata.</p>{selected?.image_ready&&record.agency&&record.volume?<Link href={pageHref(record.doc,page)}><img src={pageImagePath(record.agency,record.volume,record.doc,page)} alt={`${label}: ${record.doc}, page ${page}`} loading="lazy"/></Link>:<p className={styles.empty}>Page {page} {selected?'image is not available yet.':'does not exist in this copy.'} <Link href={`/doc/${encodeURIComponent(record.doc)}`}>Open record →</Link></p>}</section>;
}
export default async function VersionsPage({params,searchParams}:{params:Params;searchParams:Promise<SearchParamsInput>}) {
 const {doc}=await params;const primary=await getDocument(doc);if(!primary)notFound();if(primary.status==='removed')redirect(`/doc/${encodeURIComponent(doc)}`);
 const sp=await searchParams;
 const copies=await queryReadSafe<DocumentRow&{score:number}>(`SELECT d.*,n.score FROM
  (SELECT CASE WHEN doc=$1 THEN other ELSE doc END AS other,MAX(score) AS score FROM site.near_dupes WHERE doc=$1 OR other=$1 GROUP BY 1) n
  JOIN site.documents d ON d.doc=n.other WHERE n.other<>$1 ORDER BY n.score DESC NULLS LAST,d.doc`,[doc]);
 const available=copies.filter(c=>c.status!=='removed');const copy=available.find(c=>c.doc===getStr(sp,'copy'))||available[0];
 const requested=Number(getStr(sp,'page'));const page=Number.isSafeInteger(requested)&&requested>0&&requested<=Math.max(primary.page_count||1,copy?.page_count||1)?requested:1;
 return <Shell title="Copies and versions" eyebrow="Near-duplicate records" active="/ask"><Link href={`/doc/${encodeURIComponent(doc)}`}>← Back to record</Link><p>Copies are not independent tests. A high similarity score can also match a reused form; it does not establish which copy came first or whether their findings agree.</p>{!copies.length?<p>No near-duplicates are indexed for this record.</p>:<><ul>{copies.map(c=><li key={c.doc}><Link href={c.status==='removed'?`/doc/${encodeURIComponent(c.doc)}`:`/doc/${encodeURIComponent(doc)}/versions?copy=${encodeURIComponent(c.doc)}`}>{c.title||c.doc}{c.status==='removed'?' · removed by the City':` · Box ${c.box||'unavailable'}`}</Link>{c.title&&<p className="small muted mono">{c.doc}</p>}{c.status!=='removed'&&<><span> · similarity {Number(c.score).toFixed(3)} (not a probability)</span><Extraction source={{doc:c.doc,page:1,confidence:null}}/></>}</li>)}</ul>{copy&&<form className={styles.search} method="get"><input type="hidden" name="copy" value={copy.doc}/><label htmlFor="comparison-page">Page in each copy</label><input id="comparison-page" name="page" type="number" min="1" max={Math.max(primary.page_count||1,copy.page_count||1)} defaultValue={page}/><button className="button">Compare pages</button></form>}</>}
 <div className={styles.frames}><Frame record={primary} page={page} label="Selected filing"/>{copy&&<Frame record={copy} page={page} label="Comparison filing"/>}</div></Shell>;
}
