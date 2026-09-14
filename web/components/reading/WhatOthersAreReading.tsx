// Home-panel block (B22, issue #36): "What others are reading" — top 8
// documents by blended editorial-seed rank and last-7-day view count. Fails
// soft (renders nothing) before app.reading_seeds has ever been populated —
// COMMON-web.md's "schema first, code second" rule, since the seed script
// runs on its own schedule, separate from a code deploy.
//
// B25: rendered as a grid of compact tiles (not a bulleted list) — see
// reading.module.css, shared with /reading's wider grid.
import Link from 'next/link';
import { topReading } from '@/lib/reading/store';
import styles from './reading.module.css';

export async function WhatOthersAreReading() {
  let items: Awaited<ReturnType<typeof topReading>> = [];
  try {
    items = await topReading(8);
  } catch {
    items = [];
  }
  if (!items.length) return null;
  return (
    <section>
      <h2>What others are reading</h2>
      <p className="small muted">Documents readers are opening now, alongside a few notable records we picked out.</p>
      <ul className={styles.grid}>
        {items.map((item) => (
          <li className={styles.tile} key={item.doc}>
            <Link className={`bates ${styles.title}`} href={`/doc/${encodeURIComponent(item.doc)}`}>
              {item.title} ↗
            </Link>
            <p className={`small muted ${styles.why}`} title={item.why}>
              {item.why}
              {item.box ? ` · Box ${item.box}` : ''}
            </p>
          </li>
        ))}
      </ul>
      <Link className="question-link" href="/reading">
        See everything people are reading <span>→</span>
      </Link>
    </section>
  );
}

export default WhatOthersAreReading;
