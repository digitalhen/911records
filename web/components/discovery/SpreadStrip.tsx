import { type Topic, distribution } from '@/lib/discovery/data';
import { topicColor } from '@/lib/discovery/treemap';
import styles from './topicmap.module.css';

/** A proportional-width strip per box/agency the topic's documents fall in — a compact visual
 * of "spread" to sit above the plain counts list, sized by how many documents fall in each. */
export function SpreadStrip({ topic, field, rootColorIndex = 0 }: { topic: Topic; field: 'boxes' | 'agencies'; rootColorIndex?: number }) {
  const rows = distribution(topic[field]).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const total = rows.reduce((s, [, n]) => s + n, 0) || 1;
  const color = topicColor(rootColorIndex);
  return (
    <div className="strip" style={{ display: 'flex', gap: 2, margin: '8px 0 14px', height: 30 }}>
      {rows.map(([label, count]) => (
        <div
          key={label}
          title={`${field === 'boxes' ? 'Box ' : ''}${label} · ${count} document${count === 1 ? '' : 's'}`}
          style={{ flexGrow: count, flexBasis: 0, minWidth: 3, background: color, opacity: 0.35 + (0.65 * count) / total, display: 'flex', alignItems: 'center', overflow: 'hidden', padding: '0 6px' }}
        >
          <span className="small mono" style={{ color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
            {field === 'boxes' ? `Box ${label}` : label}
          </span>
        </div>
      ))}
    </div>
  );
}
