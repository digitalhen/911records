import type { Metadata } from 'next';
import { DocumentViewer } from '@/components/DocumentViewer';
import { getDocument } from '@/lib/site';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { socialMeta } from '@/lib/seo/social';

export const dynamic = 'force-dynamic';

type Params = Promise<{ doc: string; n: string }>;
type Query = Promise<SearchParamsInput>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { doc, n } = await params;
  const row = await getDocument(doc);
  const title = row ? `${row.folder || doc} · page ${n}` : `${doc} p${n}`;
  const description = row ? `Page ${n} of ${row.folder || doc}, Bates-numbered ${doc}. Mirrored independently; not affiliated with the City of New York.` : undefined;
  return {
    // Root layout's title template already appends " · 9/11 City Records".
    title,
    description,
    alternates: { canonical: `/doc/${doc}/p/${n}` },
    robots: row?.status === 'removed' ? { index: false } : undefined,
    ...socialMeta(title, description, `/doc/${doc}/p/${n}`),
  };
}

export default async function DocPageN({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { doc, n } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(n) || 1);
  return <DocumentViewer doc={doc} page={page} highlight={getStr(sp, 'hl')} />;
}
