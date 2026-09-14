import Link from 'next/link';
import { notFound } from 'next/navigation';
import { queryReadOne } from '@/lib/db';
import type { SnapshotRow } from '@/lib/site';
import { changes, captureNote, beforeMirrorNote } from '@/lib/info/catalog';
import { pageMetadata } from '@/lib/info/metadata';
import { PageShell } from '@/components/info/PageShell';
import { ChangeList } from '@/components/info/ChangeList';
import { SnapshotStats } from '@/components/info/SnapshotStats';
import { AdUnit } from '@/components/ads/AdUnit';
import { ButtonLink, Callout } from '@/components/ui';
import styles from '@/components/info/info.module.css';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ date: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props) {
  const { date } = await params;
  return pageMetadata(`Catalog capture ${date}`, 'Documents added, removed or changed in this catalog capture.', `/changes/${encodeURIComponent(date)}`);
}

export default async function ChangeDate({ params, searchParams }: Props) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{6})?$/.test(date)) notFound();
  const page = Math.max(1, Math.min(100000, Number((await searchParams).page) || 1)) | 0;
  const result = await Promise.all([
    queryReadOne<SnapshotRow>('SELECT * FROM site.snapshots WHERE date=$1', [date]),
    changes(date, 101, (page - 1) * 100),
  ]).catch(() => null);
  if (result && !result[0]) notFound();
  return (
    <PageShell active="/changes">
      <nav className="bread">
        <Link href="/changes">Releases & changes</Link>
        <span>{date}</span>
      </nav>
      <div className="eyebrow">Catalog capture</div>
      <h1>{date}</h1>
      <Callout tone="info">{captureNote}</Callout>
      {!result ? (
        <Callout tone="error" role="status">
          This capture is temporarily unavailable.
        </Callout>
      ) : (
        <>
          <SnapshotStats snapshot={result[0]!} />
          <h2>Recorded changes</h2>
          <ChangeList rows={result[1].slice(0, 100)} />
          {!result[1].length && <p>No changes recorded for this page of the capture.</p>}
          <nav aria-label="Change pages" className={`${styles.pager} actions`}>
            {page > 1 && (
              <ButtonLink variant="secondary" size="small" href={`/changes/${date}?page=${page - 1}`}>
                ← Previous
              </ButtonLink>
            )}
            {result[1].length > 100 && (
              <ButtonLink variant="secondary" size="small" href={`/changes/${date}?page=${page + 1}`}>
                Next →
              </ButtonLink>
            )}
          </nav>
        </>
      )}
      <Callout tone="info">{beforeMirrorNote}</Callout>
      <AdUnit />
    </PageShell>
  );
}
