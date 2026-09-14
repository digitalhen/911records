import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getDocument } from '@/lib/site';
import { formatDate } from '@/lib/dates';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { socialMeta } from '@/lib/seo/social';

// Rendered by middleware.ts's rewrite of /doc/<removed>* and
// /files/*/<removed>/* (real HTTP 410, not a redirect — the browser URL bar
// keeps showing the original /doc/... or /files/... address). Also reachable
// directly, in which case it degrades to a generic notice.
export const dynamic = 'force-dynamic';

type Query = Promise<SearchParamsInput>;

function batesRange(doc: string, batesEnd: string | null): string {
  if (!batesEnd || batesEnd === doc) return doc;
  return `${doc}–${batesEnd.replace(/^NYC-WTC_/, '')}`;
}

export async function generateMetadata({ searchParams }: { searchParams: Query }): Promise<Metadata> {
  const sp = await searchParams;
  const doc = getStr(sp, 'doc');
  const title = doc ? `Removed record · ${doc}` : 'Record removed';
  const description = 'This record was removed by the City and is not republished as current.';
  return {
    // Root layout's title template already appends " · 9/11 City Records".
    title,
    description,
    robots: { index: false, follow: false },
    ...socialMeta(title, description, '/gone'),
  };
}

export default async function GonePage({ searchParams }: { searchParams: Query }) {
  const sp = await searchParams;
  const doc = getStr(sp, 'doc');
  const row = doc ? await getDocument(doc) : null;

  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <div className="removed-note">
          <h3>This document was removed by the City</h3>
          {row ? (
            <>
              <p>
                It was present in an earlier snapshot and no longer appears in the City&apos;s catalog
                {row.removed_at ? ` as of ${formatDate(row.removed_at)}` : ''}. We keep the mirrored copy and
                metadata privately; it is not republished as current. Removals are most likely personal-information
                takedowns.
              </p>
              <dl>
                <dt>Bates range</dt>
                <dd className="mono">{batesRange(row.doc, row.bates_end)}</dd>
                <dt>Agency</dt>
                <dd>{row.agency || '—'}</dd>
                <dt>Pages</dt>
                <dd>{row.page_count ?? '—'}</dd>
                <dt>Removed</dt>
                <dd>{row.removed_at ? formatDate(row.removed_at) : 'date not recorded'}</dd>
              </dl>
            </>
          ) : (
            <p>This record is not available. It may have been removed by the City, or the link may be incorrect.</p>
          )}
          <p>
            See <Link href="/changes">the release and change log</Link> for the public record of additions and
            removals — it lists the Bates range, date and page count, never the content — or{' '}
            <Link href="/personal-information">read the personal-information policy</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
