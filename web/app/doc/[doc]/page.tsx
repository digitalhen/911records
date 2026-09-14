import type { Metadata } from 'next';
import { DocumentViewer } from '@/components/DocumentViewer';
import { getDocument } from '@/lib/site';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { socialMeta } from '@/lib/seo/social';

export const dynamic = 'force-dynamic';

type Params = Promise<{ doc: string }>;
type Query = Promise<SearchParamsInput>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { doc } = await params;
  const row = await getDocument(doc);
  const label = row?.folder ? `${row.folder} · ${doc}` : doc;
  const description = row
    ? `Bates ${doc}${row.bates_end && row.bates_end !== doc ? `–${row.bates_end}` : ''}, ${row.source || 'NYC Law Department release'}. Mirrored independently; not affiliated with the City of New York.`
    : undefined;
  return {
    // Root layout's title template already appends " · 9/11 City Records" —
    // do not repeat the suffix here (was rendering it twice).
    title: row ? label : doc,
    description,
    alternates: { canonical: `/doc/${doc}` },
    robots: row?.status === 'removed' ? { index: false } : undefined,
    ...socialMeta(row ? label : doc, description, `/doc/${doc}`),
  };
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

export default async function DocPage({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { doc } = await params;
  const sp = await searchParams;
  const row = await getDocument(doc);
  const jsonLd = row && {
    '@context': 'https://schema.org',
    '@type': 'DigitalDocument',
    identifier: doc,
    name: row.folder || doc,
    url: `${SITE_URL}/doc/${doc}`,
    isPartOf: row.source || undefined,
    dateCreated: row.first_seen || undefined,
  };
  return (
    <>
      <DocumentViewer doc={doc} page={1} highlight={getStr(sp, 'hl')} />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
    </>
  );
}
