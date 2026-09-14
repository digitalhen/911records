import { formatDate } from '@/lib/dates';
import Link from 'next/link';
import { snapshots, beforeMirrorNote, captureNote } from '@/lib/info/catalog';
import { pageMetadata } from '@/lib/info/metadata';
import { PageShell } from '@/components/info/PageShell';
import { SnapshotStats } from '@/components/info/SnapshotStats';
import { CopySearch } from '@/components/info/CopySearch';
import { AdUnit } from '@/components/ads/AdUnit';
import styles from '@/components/info/info.module.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return pageMetadata('Releases & changes','Captured catalog totals and additions, removals and changes in the City’s 9/11 records.','/changes'); }
export default async function Changes() {
  const rows = await snapshots().catch(() => null);
  return <PageShell active="/changes"><div className="page-title"><div><div className="eyebrow">Collection history</div><h1>Releases & changes</h1><p className="subtitle">A record of what was added, what disappeared and what the City replaced.</p></div></div><p className="coverage">{captureNote}</p>{rows === null ? <p role="status" className="error-note">Capture history is temporarily unavailable.</p> : !rows.length ? <p>No snapshots recorded yet.</p> : rows.map(s => <section key={formatDate(s.date)} style={{marginTop:30}}><div className="eyebrow">Catalog capture</div><h2><Link href={`/changes/${encodeURIComponent(formatDate(s.date))}`}>{formatDate(s.date)} →</Link></h2><SnapshotStats snapshot={s} /></section>)}<p className="coverage">{beforeMirrorNote}</p><section className={styles.prose}><h2>Saved-search alerts</h2><p className="subtitle">Keep a search link to revisit as records arrive.</p><CopySearch /><h2 style={{marginTop:28}}>When a record changes</h2><p className="subtitle">Saved Bates references stay checkable. Recheck the current official PDF before citing. Removed records are identified without republishing their content or folder labels.</p></section><AdUnit /></PageShell>;
}
