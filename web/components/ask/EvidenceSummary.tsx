import type { AskAnswer } from '@/lib/ask/answer';
import type { CiteLike } from './shared';

/** Evidence context is not a direct answer. Only validated citations can render. */
export function EvidenceSummary({ sentences, pages }: {
  sentences: NonNullable<AskAnswer['evidenceSummary']>;
  pages: CiteLike[];
}) {
  const byBates = new Map(pages.map(page => [page.batesPage, page]));
  return <section className="answer-copy" aria-labelledby="evidence-summary-heading">
    <h2 id="evidence-summary-heading">What the retrieved records show</h2>
    {sentences.map((sentence, index) => <p key={index}>
      {sentence.text}{' '}
      {sentence.cites.map(bates => {
        const page = byBates.get(bates);
        return page ? <a key={bates} className="citation" href={`/doc/${encodeURIComponent(page.doc)}/p/${page.page}`}
          aria-label={`Open Bates page ${bates}`}>[{bates.replace(/^NYC-WTC_/, '')}] ↗</a> : null;
      })}
    </p>)}
  </section>;
}
