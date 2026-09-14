import { formatDate, type DatabaseDate } from '@/lib/dates';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { queryRead } from '@/lib/db';
import { browseUrl, filters, levels, number, segment, unsegment } from '@/lib/info/catalog';
import { pageMetadata } from '@/lib/info/metadata';
import { PageShell } from '@/components/info/PageShell';
import { AdUnit } from '@/components/ads/AdUnit';
import styles from '@/components/info/info.module.css';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<{ source?: string; page?: string }> };
export async function generateMetadata({ params, searchParams }: Props) {
  const { path = [] } = await params; const { source } = await searchParams;
  return pageMetadata('Browse records', 'Follow the City’s collection, agency, volume, box and folder labels to Bates-numbered documents.', browseUrl(path.map(unsegment), source));
}
interface Group { label: string | null; documents: number; pages: number }
interface Doc { doc: string; bates_end: string | null; page_count: number; status: string; removed_at: DatabaseDate | null }
export default async function Browse({ params, searchParams }: Props) {
  const { path: raw = [] } = await params;
  if (raw.length > 4) notFound();
  const path = raw.map(unsegment); const { source, page: pageInput } = await searchParams;
  const page = Math.max(1, Math.min(100000, Number(pageInput) || 1)) | 0;
  const { where, params: values } = filters(path, source);
  let groups: Group[] = [], collections: Group[] = [], docs: Doc[] = [], total: Group | undefined, unavailable = false;
  try {
    const results = await Promise.all([
      queryRead<Group>(`SELECT COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents ${where}`, values),
      queryRead<Group>("SELECT COALESCE(source,'') AS label, COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents GROUP BY COALESCE(source,'') ORDER BY label"),
      path.length < 4 ? queryRead<Group>(`SELECT ${levels[path.length]} AS label, COUNT(*) AS documents, COALESCE(SUM(page_count),0) AS pages FROM site.documents ${where} GROUP BY ${levels[path.length]} ORDER BY ${levels[path.length]} NULLS LAST`, values) : Promise.resolve([]),
      path.length === 4 ? queryRead<Doc>(`SELECT doc,bates_end,page_count,status,removed_at FROM site.documents ${where} ORDER BY doc LIMIT 101 OFFSET $${values.length+1}`, [...values,(page-1)*100]) : Promise.resolve([]),
    ]);
    [total] = results[0]; collections = results[1]; groups = results[2]; docs = results[3];
  } catch { unavailable = true; }
  if (!unavailable && !total?.documents && (raw.length || source !== undefined)) notFound();
  return <PageShell active="/browse"><div className="page-title"><div><div className="eyebrow">Browse records</div><h1>The order the City kept.</h1><p className="subtitle">Follow the collection, agency, volume, box and folder label to the documents inside.</p></div></div><div className={styles.columns}><aside className={styles.sidebar}><h2>Collections</h2><Link href="/browse">All collections</Link>{collections.map(c => <Link key={c.label} href={browseUrl([], c.label || '')} aria-current={source === c.label ? 'page' : undefined}>{c.label || 'Collection not recorded'}<br /><span className="small muted">{number(c.documents)} documents · {number(c.pages)} pages</span></Link>)}<p className={styles.note}>City source labels are preserved. No machine-generated descriptions.</p></aside><section><nav className="bread" aria-label="Breadcrumb"><Link href="/browse">Collection</Link>{source !== undefined && <Link href={browseUrl([],source)}>{source || 'Not recorded'}</Link>}{path.map((part,i) => <Link key={i} href={browseUrl(path.slice(0,i+1),source)}>{part || `${levels[i]} not recorded`}</Link>)}</nav><h2>{path.length === 4 ? 'Documents in this folder' : ['Agencies', 'Volumes', 'Boxes', 'Folders'][path.length]}</h2>{path.length === 4 && <p className="subtitle">Folder label / City-provided: {path[3] || 'Not recorded'}</p>}{unavailable ? <p role="status" className="error-note">The collection catalog is temporarily unavailable. Please try again later.</p> : <><p className={styles.note}>{number(total?.documents)} documents · {number(total?.pages)} pages</p>{groups.map(g => <div className={styles.row} key={segment(g.label)}><Link href={browseUrl([...path,g.label],source)}>{g.label || 'Not recorded'} →</Link><span className="small muted">{number(g.documents)} documents · {number(g.pages)} pages</span></div>)}{docs.slice(0,100).map(d => <div className={styles.row} key={d.doc}><div>{d.status === 'removed' ? <><Link className="bates" href={`/doc/${encodeURIComponent(d.doc)}`}>{d.doc}{d.bates_end !== d.doc && d.bates_end ? ` – ${d.bates_end}` : ''} ↗</Link><p className="small muted">Removed by the City{d.removed_at ? ` on ${formatDate(d.removed_at)}` : ' (date not recorded)'}</p></> : <Link className="bates" href={`/doc/${encodeURIComponent(d.doc)}`}>{d.doc}{d.bates_end !== d.doc && d.bates_end ? ` – ${d.bates_end}` : ''} ↗</Link>}</div><span className="small muted">{number(d.page_count)} pages</span></div>)}{!total?.documents && <p>No catalog records yet.</p>}{path.length === 4 && <nav aria-label="Document pages" className={styles.pager}>{page > 1 && <Link href={`${browseUrl(path,source)}${source === undefined ? '?' : '&'}page=${page-1}`}>← Previous</Link>}{docs.length > 100 && <Link href={`${browseUrl(path,source)}${source === undefined ? '?' : '&'}page=${page+1}`}>Next →</Link>}</nav>}</>}</section></div><AdUnit /></PageShell>;
}
