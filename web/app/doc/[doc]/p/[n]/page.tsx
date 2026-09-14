import type { Metadata } from 'next';
import { DocumentViewer } from '@/components/DocumentViewer';
import { getDocument } from '@/lib/site';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';

export const dynamic = 'force-dynamic';

type Params = Promise<{ doc: string; n: string }>;
type Query = Promise<SearchParamsInput>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { doc, n } = await params;
  const row = await getDocument(doc);
  return {
    title: row ? `${row.folder || doc} · page ${n} · 9/11 City Records` : `${doc} p${n}`,
    alternates: { canonical: `/doc/${doc}/p/${n}` },
    robots: row?.status === 'removed' ? { index: false } : undefined,
  };
}

export default async function DocPageN({ params, searchParams }: { params: Params; searchParams: Query }) {
  const { doc, n } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(n) || 1);
  return <DocumentViewer doc={doc} page={page} highlight={getStr(sp, 'hl')} />;
}
