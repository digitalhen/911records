import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listEntities, entityLinkHref, TYPE_LABELS, ENTITY_TYPES, type PanelRow } from '@/lib/discovery/data';
import { Shell, Extraction, metadata } from '@/components/discovery/Shared';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumb';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic = 'force-dynamic';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PAGE_SIZE = 60;
const VALID_TYPES = [...ENTITY_TYPES, 'signatory'] as const;
type Params = Promise<{ type: string }>;
type SP = Promise<{ letter?: string; page?: string }>;

function span(row: PanelRow): string {
  return row.first_date || row.last_date ? `${row.first_date || 'date unavailable'} – ${row.last_date || 'date unavailable'}` : 'Date unavailable';
}

export async function generateMetadata({ params }: { params: Params }) {
  const { type } = await params;
  if (!(VALID_TYPES as readonly string[]).includes(type)) return metadata('Entities', 'Browse entities in the City’s released records.', '/entities');
  const label = TYPE_LABELS[type]!;
  return metadata(`${label} · all entities`, `Every indexed ${label.toLowerCase()} entry, alphabetically, with source-page counts.`, `/entities/${type}`);
}

export default async function EntityTypePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { type } = await params;
  if (!(VALID_TYPES as readonly string[]).includes(type)) notFound();
  const { letter: rawLetter, page: rawPage } = await searchParams;
  const letter = rawLetter && /^[A-Za-z]$/.test(rawLetter) ? rawLetter.toUpperCase() : undefined;
  const page = Math.max(1, Number(rawPage) || 1);
  const result = await listEntities(type, { letter, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
  if (!result) notFound();
  const { rows, total } = result;
  if (page > 1 && !rows.length) notFound();
  const label = TYPE_LABELS[type]!;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    if (letter) params.set('letter', letter);
    if (page > 1) params.set('page', String(page));
    for (const [k, v] of Object.entries(overrides)) v === null ? params.delete(k) : params.set(k, v);
    const s = params.toString();
    return s ? `/entities/${type}?${s}` : `/entities/${type}`;
  };
  const crumbs = breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: 'Entities', path: '/entities' }, { name: label, path: `/entities/${type}` }]);
  return <Shell title={label} eyebrow="All entities of this type">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
    <Link href="/entities">← All panels</Link>
    <p>{total} indexed {label.toLowerCase()} {total === 1 ? 'entry' : 'entries'}, ranked A–Z. Machine-extracted; check the source page for anything you cite.</p>
    <nav className={styles.alpha} aria-label="Filter by first letter">
      <Link href={qs({ letter: null, page: null })} className={!letter ? styles.alphaActive : undefined}>All</Link>
      {LETTERS.map(l => <Link key={l} href={qs({ letter: l, page: null })} className={letter === l ? styles.alphaActive : undefined}>{l}</Link>)}
    </nav>
    {!rows.length && <p className={styles.empty}>No entries {letter ? `starting with “${letter}”` : ''} are indexed yet.</p>}
    <ul className={styles.cards}>
      {rows.map(r => <li key={r.id}>
        <Link href={entityLinkHref(r)}>{r.label}</Link>
        <p className="small muted">{r.n_pages} pages · {r.n_docs} documents · {span(r)}</p>
        <Extraction confidence={null} />
      </li>)}
    </ul>
    {pages > 1 && <div className="pagination">
      <span>Page {page} of {pages}</span>
      <span className="actions">
        {page > 1 && <Link className="button" href={qs({ page: page - 1 > 1 ? String(page - 1) : null })}>← Previous</Link>}
        {page < pages && <Link className="button" href={qs({ page: String(page + 1) })}>Next →</Link>}
      </span>
    </div>}
  </Shell>;
}
