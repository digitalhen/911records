import Link from 'next/link';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';
import { comparisons, reportUrl } from '@/lib/contradictions/data';
import styles from './comparisons.module.css';
import { SubmissionForm } from '@/components/contradictions/SubmissionForm';

function Citations({ sources }: { sources: { url: string; source: string }[] }) {
  return <span className="small"> {sources.map((source, i) => <span key={source.url}> <a href={source.url} title={source.source} aria-label={`Source ${i + 1}: ${source.source}`}>[{i + 1}]</a></span>)}</span>;
}

export function generateMetadata() {
  return pageMetadata('Contradictions', 'Compare public reassurances and draft statements with the 9/11 records, with exact source pages and context.', '/contradictions');
}

export default function ContradictionsPage() {
  return <PageShell active="/contradictions">
    <div className={styles.intro}>
      <span className={styles.kind}>Statements and the documentary record</span>
      <h1>Contradictions</h1>
      <p>What officials said, what drafts warned, and what the records show. Each comparison links to the source and explains both the finding and its limits.</p>
      <p className="small muted">Curated comparisons · {comparisons.length} entries · Reviewed September 15, 2026</p>
    </div>
    <ul className={styles.index} aria-label="Jump to a comparison">
      {comparisons.map((entry, i) => <li key={entry.slug}><a href={`#${entry.slug}`}>{i + 1}. {entry.title}</a></li>)}
    </ul>
    {comparisons.map(entry => {
      const sources = [...new Map([entry.left, entry.right, ...(entry.supportingSources ?? [])].map(source => [source.url, source])).values()];
      return <article key={entry.slug} id={entry.slug} className={styles.card} aria-labelledby={`${entry.slug}-title`}>
      <span className={styles.kind}>{entry.kind}</span>
      <h2 id={`${entry.slug}-title`}><a href={`#${entry.slug}`}>{entry.title}</a></h2>
      <div className={styles.pair}>
        {[entry.left, entry.right].map((statement, i) => <section key={i} className={styles.statement}>
          <h3>{statement.label}</h3>
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
    </article>; })}
    <section className={styles.method} aria-labelledby="about-comparisons">
      <h2 id="about-comparisons">About these comparisons</h2>
      <p>“Contradictions” includes changed draft wording and reassurances later found to lack sufficient support. Each entry names the specific relationship. These are editorial selections, not an automated verdict or a complete account of the response.</p>
      <p>The initial entries draw on the EPA Office of Inspector General’s August 21, 2003 report, <a href={reportUrl}>EPA’s Response to the World Trade Center Collapse: Challenges, Successes, and Areas for Improvement</a> (2003-P-00012), preserved in the City’s released records. These findings were published in 2003; their inclusion here does not make them newly discovered. Read the full report, including the agency’s responses, for the broader record.</p>
      <p>Quotations are excerpts; source links open the complete page or release. More comparisons can be added as their sources are checked. <a href="#submit">Suggest a comparison or submit a correction.</a></p>
      <p><Link href="/browse">Browse the records</Link> · <Link href="/search">Search for evidence</Link></p>
    </section>
    <section id="submit" className={styles.method} aria-labelledby="submit-heading">
      <h2 id="submit-heading">Suggest a comparison or correction</h2>
      <p>Include the source pages so we can check the evidence. Submissions are stored privately for review by Cleartext Labs and are not published automatically. No name, email address, or account is required. Please leave out private personal information.</p>
      <SubmissionForm />
    </section>
  </PageShell>;
}
