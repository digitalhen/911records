// /reading (B22, issue #36): every seeded "What others are reading" entry,
// grouped, blended-ranked. Reuses the discovery layer's Shell/metadata shell
// (components/discovery/Shared.tsx) and its existing "discovery"/"result-item"
// styling rather than adding new CSS — matches /entities, /topics and the
// document-page discovery sections.
import Link from 'next/link';
import { Shell, metadata as pageMetadata } from '@/components/discovery/Shared';
import { readingGroups, type ReadingItem } from '@/lib/reading/store';
import styles from '@/components/reading/reading.module.css';

export const dynamic = 'force-dynamic';

// Fixed editorial order; any group the seed script introduces later still
// renders, appended after these.
const GROUP_ORDER = ['Start here', 'Sampling and results', 'What the City knew', 'Buildings'];

export async function generateMetadata() {
  return pageMetadata(
    'What others are reading',
    "Notable City 9/11 records, picked out and ranked by what readers are actually opening.",
    '/reading',
  );
}

export default async function ReadingPage() {
  let groups: Record<string, ReadingItem[]> = {};
  try {
    groups = await readingGroups();
  } catch {
    groups = {};
  }
  const names = [...GROUP_ORDER, ...Object.keys(groups).filter((g) => !GROUP_ORDER.includes(g))];
  const hasAny = names.some((name) => groups[name]?.length);

  return (
    <Shell title="What others are reading" eyebrow="Notable records, picked out" active="/reading">
      <p>
        A starting point into the collection: documents readers are opening now, blended with records we picked
        out for what they show — sampling results, what the City knew at the time, and by-building context. Never
        a folder cover sheet, and never a document filed under a private individual&apos;s name.
      </p>
      {!hasAny && <p className="muted">Nothing seeded yet — check back soon.</p>}
      {names.map((name) => {
        const rows = groups[name];
        if (!rows?.length) return null;
        return (
          <section className="discovery" key={name}>
            <h2>{name}</h2>
            <ul className={`${styles.grid} ${styles.gridWide}`}>
              {rows.map((item) => (
                <li className={styles.tile} key={item.doc}>
                  <Link className={styles.title} href={`/doc/${encodeURIComponent(item.doc)}`}>
                    {item.title}
                  </Link>
                  <p className={`small muted ${styles.why}`} title={item.why}>
                    {item.why}
                    {item.box ? ` · Box ${item.box}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="quality">
        Ranking blends our editorial order with anonymous, aggregate view counts from the last 7 days — a
        document+day counter only, never a visitor identifier, session id or IP address.
      </p>
    </Shell>
  );
}
