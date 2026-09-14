import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { pageHref, type Source, type Occurrence } from '@/lib/discovery/data';
import { socialMeta } from '@/lib/seo/social';
import styles from './discovery.module.css';
export function metadata(title: string, description: string, canonical: string): Metadata { return { title, description, alternates: { canonical }, ...socialMeta(title, description, canonical) }; }
export function Shell({ title, eyebrow, active = '/entities', children }: {title: string; eyebrow: string; active?: string; children: ReactNode}) {
  return <><Header active={active}/><main id="main" className={styles.root}><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{children}</main><Footer/></>;
}
export function Extraction({ source, confidence = source?.confidence }: { source?: Source | null; confidence?: number | null }) {
  return <small className="extraction">machine-extracted · confidence {confidence != null && Number.isFinite(confidence) ? Number(confidence).toFixed(2) : 'unavailable'}{source && <> · <Link href={pageHref(source.doc,source.page)}>Check page ↗</Link></>}</small>;
}
export function Caveat() { return <p className="quality">Machine extraction can misread a scan. Check the source page. Stored confidence scores are extractor outputs, not a guarantee of accuracy; regex matches currently carry 1.00.</p>; }
/** A clearly separated, consistently-headed section — the building-page shape (docs/PLAN.md §Stage 4) reused for entity/signatory detail pages: Overview, Documents, Where it appears, Related entities. */
export function Section({ id, title, action, children }: { id?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return <section id={id} className={styles.section}><div className={styles.sectionHead}><h2>{title}</h2>{action}</div>{children}</section>;
}
export function Records({ rows, heading = 'Documents grouped by role' }: {rows: Occurrence[]; heading?: string}) {
  const roles = [...new Set(rows.map(r => r.role || 'Mentioned'))];
  return <Section id="records" title={heading}>{!rows.length && <p>No available source pages are indexed yet.</p>}{roles.map((role, i) => <section key={role} id={`role-${i}`}><h3>{role} · <a href={`#role-${i}`}>{new Set(rows.filter(r => (r.role || 'Mentioned') === role).map(r=>r.doc)).size} documents</a></h3>{rows.filter(r => (r.role || 'Mentioned') === role).map(r => <article className="result-item" key={`${r.doc}:${r.page}:${r.confidence}`}><Link className="mono" href={pageHref(r.doc,r.page)}>{r.doc} · page {r.page}</Link><p className="small muted">{r.agency || 'Agency not recorded'} · Box {r.box || 'not recorded'}</p><Extraction source={r}/></article>)}</section>)}</Section>;
}
