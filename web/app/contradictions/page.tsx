import { OPERATOR_NAME } from '@/lib/brand';
import Link from 'next/link';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';
import { comparisons, comparisonsByRelease, reportUrl, type Comparison } from '@/lib/contradictions/data';
import styles from './comparisons.module.css';
import { SubmissionForm } from '@/components/contradictions/SubmissionForm';

function Citations({ sources }: { sources: { url: string; source: string }[] }) {
  return <span className="small"> {sources.map((source, i) => <span key={source.url}> <a href={source.url} title={source.source} aria-label={`Source ${i + 1}: ${source.source}`}>[{i + 1}]</a></span>)}</span>;
}

function ComparisonCard({ entry, n }: { entry: Comparison; n: number }) {
  const sources = [...new Map([entry.left, entry.right, ...(entry.supportingSources ?? [])].map(source => [source.url, source])).values()];
  return <article key={entry.slug} id={entry.slug} className={styles.card} aria-labelledby={`${entry.slug}-title`}>
  <span className={styles.kind}>{entry.kind}</span>
  <h3 id={`${entry.slug}-title`}><a href={`#${entry.slug}`}>{n}. {entry.title}</a></h3>
  <div className={styles.pair}>
    {[entry.left, entry.right].map((statement, i) => <section key={i} className={styles.statement}>
      <h4>{statement.label}</h4>
      <blockquote cite={statement.url}>“{statement.quote}”</blockquote>
      <p className="small">{statement.attribution}</p>
      <p className="small muted">{statement.date}</p>
      <a className="small" href={statement.url}>{statement.source} ↗</a>
    </section>)}
  </div>
  <div className={styles.notes}>
    <p><strong>What the comparison shows. </strong>{entry.assessment}<Citations sources={sources} /></p>
    <p><strong>Context. </strong>{entry.context}<Citations sources={sources} /></p>
    <p><strong>Interpretation and limits. </strong>{entry.limits}<Citations sources={sources} /></p>
    <ol className="small" aria-label="Sources for this comparison">{sources.map(source => <li key={source.url}><a href={source.url}>{source.source}</a></li>)}</ol>
    <a className="small" href={`#${entry.slug}`}>Link to this comparison</a>
  </div>
  </article>;
}

export function generateMetadata() {
  return pageMetadata('Contradictions', 'Compare public reassurances and draft statements with the 9/11 records, with exact source pages and context.', '/contradictions');
}

export default function ContradictionsPage() {
  const number = new Map(comparisonsByRelease.flatMap(group => group.entries).map((entry, i) => [entry.slug, i + 1]));
  return <PageShell active="/contradictions">
    <div className={styles.intro}>
      <span className={styles.kind}>Statements and the documentary record</span>
      <h1>Contradictions</h1>
      <p>What officials said, what drafts warned, and what the records show. Each comparison links to the source and explains both the finding and its limits.</p>
      <p className="small muted">Curated comparisons · {comparisons.length} entries · Reviewed November 5, 2026</p>
    </div>
    <nav aria-label="Jump to a comparison">
      {comparisonsByRelease.map(group => <div key={group.id} className={styles.indexGroup}>
        <p className={styles.indexHeading}><strong><a href={`#${group.id}`}>{group.label}</a></strong> <span className="small muted">· {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</span></p>
        <ul className={styles.index}>
          {group.entries.map(entry => <li key={entry.slug}><a href={`#${entry.slug}`}>{number.get(entry.slug)}. {entry.title}</a></li>)}
        </ul>
      </div>)}
    </nav>
    {comparisonsByRelease.map(group => <section key={group.id} id={group.id} className={styles.release} aria-labelledby={`${group.id}-heading`}>
      <h2 id={`${group.id}-heading`} className={styles.releaseHeading}><a href={`#${group.id}`}>{group.label}</a></h2>
      <p className="small muted">{group.note}</p>
      {group.entries.map(entry => <ComparisonCard key={entry.slug} entry={entry} n={number.get(entry.slug)!} />)}
    </section>)}
    <section className={styles.method} aria-labelledby="about-comparisons">
      <h2 id="about-comparisons">About these comparisons</h2>
      <p>Comparisons are grouped by the City release that first published their records, newest first. “Contradictions” includes changed draft wording and reassurances later found to lack sufficient support. Each entry names the specific relationship. These are editorial selections, not an automated verdict or a complete account of the response.</p>
      <p>The September 8 entries draw on the EPA Office of Inspector General’s August 21, 2003 report, <a href={reportUrl}>EPA’s Response to the World Trade Center Collapse: Challenges, Successes, and Areas for Improvement</a> (2003-P-00012), preserved in the City’s released records. These findings were published in 2003; their inclusion here does not make them newly discovered. Read the full report, including the agency’s responses, for the broader record.</p>
      <p>The October 16 entries draw on records the City first published that day, including New York City Department of Health files on residential dust testing and the interagency indoor air task force. Some of these records are drafts, templates or internal emails; each entry says what the record does and does not show.</p>
      <p>Quotations are excerpts; source links open the complete page or release. More comparisons can be added as their sources are checked. <a href="#submit">Suggest a comparison or submit a correction.</a></p>
      <p><Link href="/browse">Browse the records</Link> · <Link href="/search">Search for evidence</Link></p>
    </section>
    <section id="submit" className={styles.method} aria-labelledby="submit-heading">
      <h2 id="submit-heading">Suggest a comparison or correction</h2>
      <p>Include the source pages so we can check the evidence. Submissions are stored privately for review by {OPERATOR_NAME} and are not published automatically. No name, email address, or account is required. Please leave out private personal information.</p>
      <SubmissionForm />
    </section>
  </PageShell>;
}
