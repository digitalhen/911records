import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { AnswerBody } from '@/components/ask/shared';
import { getAnswer } from '@/lib/ask/store';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const row = await getAnswer(id).catch(() => null);
  return {
    title: row ? `${row.q} — answer from records` : 'Answer from records',
    description: row ? `A cited, machine-written answer from New York City's released 9/11 records: “${row.q}”.` : undefined,
    alternates: { canonical: `/a/${id}` },
    // docs/PLAN.md SEO section: robots.txt already disallows /a/ — this is
    // belt-and-suspenders metadata, matching /search and /ask.
    robots: { index: false },
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
  const row = await getAnswer(id);
  if (!row) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Question',
    name: row.q,
    dateCreated: row.created_at,
  };

  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <SearchBox q={row.q} compact />
        <p className="small muted" style={{ marginBottom: 14 }}>
          Permanent answer · frozen citations ·{' '}
          {new Date(row.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <AnswerBody q={row.q} answer={row.answer} pages={row.cites} />
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
