import { formatDate } from '@/lib/dates';
import Link from 'next/link';
import { getMeta, getLatestSnapshot } from '@/lib/site';
import { queryReadOne } from '@/lib/db';
import { changes, number, type SafeChange } from '@/lib/info/catalog';
import { AiMark } from '@/components/ui';
import styles from './home.module.css';
const groups = [ ['For families', 'Was asbestos found on Liberty Street in October 2001?', 'Can these records connect an illness to a building?'], ['For legal research', 'Find sampling pages by address and Bates number.', 'What do the records say about re-occupancy decisions?'] ];
// B11: the one list of suggested questions the app has — reused by /ask's
// off-topic note and /search's "no searchable terms" note so both point
// somewhere real instead of inventing their own copy.
export const SUGGESTED_QUESTIONS = groups.flatMap(([, ...questions]) => questions);
function EntryPoints() { return <><section><h2>Start with a question</h2><p className="small muted">No account needed to read</p>{groups.map(([title, ...questions]) => <div key={title}><h3>{title}</h3>{questions.map(q => <Link className="question-link" href={`/ask?q=${encodeURIComponent(q)}`} key={q}>{q}<span aria-hidden><AiMark /> ↗</span></Link>)}</div>)}</section><section><h2>Find what you did not know to ask</h2><Link className="question-link" href="/browse">Browse in collection order <span>→</span></Link><Link className="question-link" href="/topics">Follow a subject · Topic map <span>→</span></Link><Link className="question-link" href="/entities">Labs, offices, contractors and substances <span>→</span></Link></section><section><h2>Reading these records</h2><p>Search uses imperfect OCR. Check the page image when a date or reading matters. Machine-written answers can misread scans and do not determine eligibility for a claim.</p><p><Link href="/personal-information">Personal-information policy</Link></p></section></>; }
export function HomePanelFallback() { return <div className={styles.panel}><div className="eyebrow">The collection</div><h2>The City’s 9/11 records</h2><p>Environmental sampling, correspondence and other records released by the NYC Law Department.</p><p role="status">Collection counts and recent changes are temporarily unavailable.</p><EntryPoints /></div>; }
export async function HomePanel() {
  try {
    const [meta, snapshot, recent, coverage] = await Promise.all([getMeta(), getLatestSnapshot(), changes(undefined, 5), queryReadOne<{ empty: number; ocr: number }>("SELECT COALESCE(SUM(pages_empty),0) AS empty, COALESCE(SUM(pages_ocr),0) AS ocr FROM site.documents WHERE status IS DISTINCT FROM 'removed'")]);
    const dates = new Map<string, SafeChange[]>();
    for (const row of recent) {
      const date = formatDate(row.date);
      dates.set(date, [...(dates.get(date) || []), row]);
    }
    return <div className={styles.panel}><div className="eyebrow">The collection</div><h2>The City’s 9/11 records</h2><div className={styles.stats}><div><strong>{number(snapshot?.documents ?? meta?.documents)}</strong><span>PDF documents</span></div><div><strong>{number(snapshot?.pages ?? meta?.pages)}</strong><span>Bates-numbered pages</span></div></div><p>Released by the NYC Law Department. Environmental sampling, correspondence and other City records.</p>{snapshot && <p className="small muted">Catalog captured {formatDate(snapshot.date)}</p>}<EntryPoints /><section><h2>Recent releases and changes</h2>{[...dates].map(([date, rows]) => <div key={date}><h3><Link href={`/changes/${encodeURIComponent(date)}`}>{date}</Link></h3><ul>{rows.map((r,i) => <li key={`${r.doc}-${i}`}><span className={`label ${r.kind}`}>{r.kind}</span> {r.kind === 'removed' || r.status === 'removed' ? <span className="bates">{r.doc}</span> : <Link className="bates" href={`/doc/${encodeURIComponent(r.doc)}`}>{r.doc} ↗</Link>}</li>)}</ul></div>)}{!recent.length && <p>No changes recorded yet.</p>}<Link className="question-link" href="/changes">View release & change log <span>→</span></Link></section><p className="small muted">Coverage: {number(coverage?.ocr)} image-only pages OCR’d by us; {number(coverage?.empty)} pages recorded without extracted text. OCR is machine-extracted; <Link href="/browse">open a record</Link> to verify against its page image.</p></div>;
  } catch { return <HomePanelFallback />; }
}
export default HomePanel;
