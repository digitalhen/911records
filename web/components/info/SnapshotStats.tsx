import type { SnapshotRow } from '@/lib/site';
import { number } from '@/lib/info/catalog';
import styles from './info.module.css';
export function SnapshotStats({ snapshot: s }: { snapshot: SnapshotRow }) {
  return <dl className={styles.stats}>{(['documents','pages','bytes','added','removed','changed'] as const).map(k => <div key={k}><dt>{k}</dt><dd>{number(s[k])}</dd></div>)}</dl>;
}
