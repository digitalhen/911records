import type { SnapshotRow } from '@/lib/site';
import { number } from '@/lib/info/catalog';
import styles from './info.module.css';
export function SnapshotStats({ snapshot: s }: { snapshot: SnapshotRow }) {
  return <dl className={styles.stats}>{(['documents','pages','bytes','added','removed','changed'] as const).map(k => <div key={k}><dt>{k === 'bytes' ? 'size' : k}</dt><dd>{k === 'bytes' ? gigabytes(s[k]) : number(s[k])}</dd></div>)}</dl>;
}

/** 36,282,050,090 bytes reads as "36.3 GB" (2026-09-14); anything under a gigabyte shows MB. */
function gigabytes(n: number | null | undefined): string {
  if (n == null) return '—';
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}
