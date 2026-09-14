import type { Metadata } from 'next';
import { DocumentViewer } from '@/components/DocumentViewer';
import { getDocument } from '@/lib/siteDb';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';

export const dynamic = 'force-dynamic';

type Params = Promise<{ doc: string }>;
type Query = Promise<SearchParamsInput>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { doc } = await params;
  const row = getDocument(doc);
  const label = row?.folder ? `${row.folder} · ${doc}` : doc;
  return {
    title: row ? `${label} · 9/11 City Records` : doc,
    description: row
      ? `Bates ${doc}${row.bates_end && row.bates_end !== doc ? `–${row.bates_end}` : ''}, ${row.source || 'NYC Law Department release'}. Mirrored independently; not affiliated with the City of New York.`
      : undefined,
    alternates: { canonical: `/doc/${doc}` },
    robots: row?.status === 'removed' ? { index: false } : undefined,
  };
}

export default async function DocPage({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { doc } = await params;
  const sp = await searchParams;
  const row = getDocument(doc);
  const jsonLd = row && {
    '@context': 'https://schema.org',
    '@type': 'DigitalDocument',
    identifier: doc,
    name: row.folder || doc,
    isPartOf: row.source || undefined,
  };
  return (
    <>
      <DocumentViewer doc={doc} page={1} highlight={getStr(sp, 'hl')} />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
    </>
  );
}
