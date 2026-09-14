import { formatDate } from '@/lib/dates';
import Link from 'next/link';
import { number, type SafeChange } from '@/lib/info/catalog';
import styles from './info.module.css';

export function ChangeList({ rows }: { rows: SafeChange[] }) {
  return (
    <ul className={styles.list}>
      {rows.map((r, i) => (
        <li className={styles.row} key={`${formatDate(r.date)}-${r.doc}-${r.kind}-${i}`}>
          <div>
            {/* .label modifier classes (removed/redacted) are defined in globals.css — apply the kind so they take effect */}
            <span className={`label ${r.kind}`}>{r.kind}</span>
            <div className="bates">
              {r.kind === 'removed' || r.status === 'removed' ? (
                <span>
                  {r.title || r.doc}
                  {!r.title && r.bates_end && r.bates_end !== r.doc ? ` – ${r.bates_end}` : ''}
                </span>
              ) : (
                <Link href={`/doc/${encodeURIComponent(r.doc)}`}>
                  {r.title || r.doc}
                  {!r.title && r.bates_end && r.bates_end !== r.doc ? ` – ${r.bates_end}` : ''} ↗
                </Link>
              )}
            </div>
            {r.title && (
              <p className="small muted mono">
                {r.doc}
                {r.bates_end && r.bates_end !== r.doc ? ` – ${r.bates_end}` : ''}
              </p>
            )}
            {r.summary && <p className="small">{r.summary}</p>}
            <p className="small muted">
              {r.agency || 'Agency not recorded'} · {number(r.page_count)} pages
            </p>
            {r.status === 'removed' && r.kind !== 'removed' && (
              <p className="small muted">Currently removed by the City{r.removed_at ? ` on ${formatDate(r.removed_at)}` : ''}.</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
