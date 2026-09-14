import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { SearchTabs } from '@/components/SearchTabs';
import { CaseBinderBar } from '@/components/case/CaseBinderBar';
import { AnswerBody, PriorTurn, searchFallbackUrl } from '@/components/ask/shared';
import { ListAnswer } from '@/components/ask/ListAnswer';
import { AiMark, Callout } from '@/components/ui';
import { getAnswer, getAnswerChain } from '@/lib/ask/store';
import { socialMeta } from '@/lib/seo/social';

function answerDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const row = await getAnswer(id).catch(() => null);
  const title = row ? `${row.q} — answer from records` : 'Answer from records';
  const description = row ? `A cited, machine-written answer from New York City's released 9/11 records: “${row.q}”.` : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/a/${id}` },
    // docs/PLAN.md SEO section: robots.txt already disallows /a/ — this is
    // belt-and-suspenders metadata, matching /search and /ask.
    robots: { index: false },
    ...socialMeta(title, description, `/a/${id}`),
  };
}

/**
 * The frozen answer permalink (docs/PLAN.md URL scheme: "/ask?q= -> /a/<id>",
 * "citations depend on it"). Renders exactly what was validated and stored
 * at write time (lib/ask/store.ts) — never re-runs retrieval or the model,
 * so a citation here can never drift from what the page actually said the
 * day it was written.
 */
export default async function AnswerPage({ params }: { params: Params }) {
  const { id } = await params;
  // B17: the full thread `id` belongs to — root first, `id`'s own row last.
  // A single, non-follow-up answer is just a chain of length 1.
  const chain = await getAnswerChain(id);
  if (chain.length === 0) notFound();
  const row = chain[chain.length - 1]!;
  const priorTurns = chain.slice(0, -1);

  // B24 ("Refresh this answer"): the newer/older neighbor rows, fetched only
  // when this row actually points to one — never re-derived, so a broken
  // pointer (a row somehow deleted) just hides the banner/line rather than
  // erroring the whole permalink.
  const newerRow = row.superseded_by ? await getAnswer(row.superseded_by).catch(() => null) : null;
  const olderRow = row.refreshed_from ? await getAnswer(row.refreshed_from).catch(() => null) : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Question',
    name: row.q,
    dateCreated: row.created_at,
  };

  return (
    <>
      <Header active="/ask" />
      <CaseBinderBar />
      <main id="main">
        {newerRow && (
          <Callout tone="info" className="mb-4">
            A newer version of this answer exists, written {answerDate(newerRow.created_at)}.{' '}
            <Link href={`/a/${newerRow.id}`}>Open the newer version →</Link>
          </Callout>
        )}
        <SearchBox q={row.q} compact />
        <SearchTabs active="answer" answerHref={`/a/${row.id}`} documentsHref={searchFallbackUrl(row.q)} />
        <p className="small muted mb-4">
          Permanent answer · frozen citations ·{' '}
          {new Date(row.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        {olderRow && (
          <p className="small muted mb-4">
            Refreshed from an earlier answer ({answerDate(olderRow.created_at)}) →{' '}
            <Link href={`/a/${olderRow.id}`}>earlier version</Link>
          </p>
        )}
        {!row.superseded_by && (
          <p className="small muted mb-4">
            <Link href={`/ask?refresh=${row.id}`} className="question-link">
              Refresh this answer <AiMark /> <span>→</span>
            </Link>
          </p>
        )}
        {priorTurns.length > 0 && (
          <div className="mb-5">
            {priorTurns.map((turn) => (
              <PriorTurn key={turn.id} id={turn.id} q={turn.q} firstSentence={turn.answer.sentences[0]?.text ?? ''} />
            ))}
          </div>
        )}
        {row.list_result ? (
          <ListAnswer q={row.q} result={row.list_result} answerId={row.id} />
        ) : (
          <AnswerBody q={row.q} answer={row.answer} pages={row.cites} answerId={row.id} />
        )}
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
