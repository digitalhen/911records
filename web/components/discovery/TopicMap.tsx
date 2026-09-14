import Link from 'next/link';
import { type Topic, topicTitle, terms, distribution } from '@/lib/discovery/data';
import { squarify, topicColor, rootAncestorId } from '@/lib/discovery/treemap';
import styles from './topicmap.module.css';

const STAGE_W = 1000;
const STAGE_H = 500;

/** Renders the current level of the topic tree as a squarified treemap (regions sized by
 * pages) plus a side rail of the same topics as a plain list. `nodes` are the topics visible
 * at this zoom level (root topics, or the children of `current`); `topics` is the full set,
 * used only to tell a parent (has sub-topics, zooms in) from a leaf (opens its documents) and
 * to colour every box by its top-level ancestor. Pure server markup — zoom and drill-down are
 * real navigations (`?topic=<id>` / `/topics/<id>`), so back/forward and keyboard tabbing work
 * with no client script. */
export function TopicMap({ topics, nodes, label }: { topics: Topic[]; nodes: Topic[]; label: string }) {
  if (!nodes.length) return <p>No sub-topics indexed.</p>;
  const parentOf = new Map<number, number | null>();
  for (const t of topics) parentOf.set(t.id, topics.some((p) => p.id === t.parent) ? t.parent : null);
  const roots = topics.filter((t) => parentOf.get(t.id) == null).sort((a, b) => b.size_pages - a.size_pages || a.id - b.id);
  const hasChildren = (id: number) => topics.some((t) => t.id !== id && parentOf.get(t.id) === id);
  const rootIndex = (id: number) => Math.max(0, roots.findIndex((r) => r.id === rootAncestorId(id, parentOf)));
  const href = (t: Topic) => (hasChildren(t.id) ? `/topics?topic=${t.id}` : `/topics/${t.id}`);
  const maxPages = Math.max(1, ...nodes.map((n) => n.size_pages));

  const rects = squarify(nodes.map((n) => ({ size: Math.max(1, n.size_pages), data: n })), STAGE_W, STAGE_H);
  const sorted = [...nodes].sort((a, b) => b.size_pages - a.size_pages || a.id - b.id);

  return (
    <div className={styles.wrap}>
      <div className={styles.stage} role="group" aria-label={label}>
        {rects.map((r) => {
          const t = r.data;
          const color = topicColor(rootIndex(t.id));
          const boxes = distribution(t.boxes);
          const share = Math.round((100 * t.size_pages) / maxPages);
          return (
            <Link
              key={t.id}
              href={href(t)}
              className={styles.box}
              style={{ left: `${(r.x / STAGE_W) * 100}%`, top: `${(r.y / STAGE_H) * 100}%`, width: `${(r.w / STAGE_W) * 100}%`, height: `${(r.h / STAGE_H) * 100}%`, background: color }}
              aria-label={`${topicTitle(t)} — ${t.size_pages} pages, ${t.size_docs} documents${hasChildren(t.id) ? '. Has sub-topics' : ''}`}
            >
              <strong>{topicTitle(t)}</strong>
              <span className={styles.count}>{t.size_pages} pages · {t.size_docs} documents</span>
              <span className={styles.stackBar} style={{ width: `${Math.max(3, share)}%` }} />
              <span className={styles.tip}>
                {t.description || terms(t.terms).join(' · ') || 'No description indexed.'}
                {boxes.length ? <> · Boxes {boxes.map(([b]) => b).slice(0, 4).join(', ')}</> : null}
                {hasChildren(t.id) ? ' · Click to zoom into sub-topics' : ' · Click to open documents'}
              </span>
            </Link>
          );
        })}
      </div>
      <aside className={styles.rail}>
        <h2>Visible topics</h2>
        <ul className={styles.railList}>
          {sorted.map((t) => (
            <li key={t.id} className={styles.railItem}>
              <Link href={href(t)}>
                <span className={styles.swatch} style={{ background: topicColor(rootIndex(t.id)) }} aria-hidden="true" />
                <span className={styles.railLabel}>{topicTitle(t)}</span>
                <span className={styles.railCount}>{t.size_pages}p · {t.size_docs}d</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
