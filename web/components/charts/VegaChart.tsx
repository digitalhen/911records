import type { ReactNode } from 'react';
import { renderVegaLite, type VlSpec } from '@/lib/charts/vega';
import styles from './VegaChart.module.css';

/** Server component: a Vega-Lite chart rendered to inline SVG, with a caption underneath. */
export async function VegaChart({ spec, width, caption, label }: { spec: VlSpec; width?: number; caption?: ReactNode; label: string }) {
  const svg = await renderVegaLite(spec, width);
  return (
    <figure className={styles.figure}>
      <div className={styles.chart} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
    </figure>
  );
}
