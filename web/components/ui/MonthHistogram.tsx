import styles from './MonthHistogram.module.css';

export interface MonthCount {
  /** ISO month, "YYYY-MM". Only months with count > 0 need be present — gaps are inferred. */
  month: string;
  count: number;
}

interface MonthHistogramProps {
  data: MonthCount[];
  /** Accessible label for the chart, e.g. "Source pages by extracted month". Used on the
   *  fallback table's caption; the chart itself relies on per-bar labels + that table. */
  ariaLabel: string;
  /** One-line caption rendered under the chart. */
  caption?: string;
  /** Singular unit noun for tooltips/table header, e.g. "page" (pluralized with a trailing s). */
  unit?: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Runs of empty months longer than this collapse to a single break mark instead of
// spending axis width on years with nothing to show.
const GAP_THRESHOLD_MONTHS = 12;
const SLOT_WIDTH = 14;
const BAR_WIDTH = 9;
const CHART_HEIGHT = 84; // svg user units; matches the CSS pixel height so vertical scale stays 1:1

function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return y * 12 + (m - 1);
}
function indexToMonth(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[((m - 1) % 12 + 12) % 12]} ${y}`;
}

type Slot = { kind: 'month'; month: string; count: number } | { kind: 'gap'; from: string; to: string; span: number };

function buildSlots(data: MonthCount[]): Slot[] {
  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month));
  const slots: Slot[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    if (i > 0) {
      const prevIdx = monthIndex(sorted[i - 1]!.month);
      const curIdx = monthIndex(cur.month);
      const empty = curIdx - prevIdx - 1;
      if (empty > 0) {
        if (empty > GAP_THRESHOLD_MONTHS) {
          slots.push({ kind: 'gap', from: indexToMonth(prevIdx + 1), to: indexToMonth(curIdx - 1), span: empty });
        } else {
          for (let g = 1; g <= empty; g++) slots.push({ kind: 'month', month: indexToMonth(prevIdx + g), count: 0 });
        }
      }
    }
    slots.push({ kind: 'month', month: cur.month, count: cur.count });
  }
  return slots;
}

/**
 * Shared month-by-month activity chart (building / entity / signatory pages) — one
 * implementation so the three don't drift. Inline SVG bars, no charting library, fully
 * server-renderable. Months run earliest → latest on the x axis; a run of more than
 * `GAP_THRESHOLD_MONTHS` consecutive empty months collapses to a small break mark rather
 * than spending width on it. Per-month hover/focus tooltip is an HTML overlay slot with a
 * CSS ::after (not an SVG <title>: those only show after a long delay and the stretched SVG
 * would distort any text; an <a> wrapper hydration-errored before). Year ticks and the
 * first/last month label make up the x axis.
 * A visually-hidden <table> carries the same data for assistive tech / no-CSS fallback.
 */
export function MonthHistogram({ data, ariaLabel, caption, unit = 'page' }: MonthHistogramProps) {
  const real = data.filter(d => d.count > 0 && /^\d{4}-\d{2}$/.test(d.month));
  if (!real.length) return null;
  const slots = buildSlots(real);
  const max = Math.max(1, ...real.map(d => d.count));
  const width = slots.length * SLOT_WIDTH;

  const yearLabels: { pct: number; year: number }[] = [];
  let lastYear: number | null = null;
  slots.forEach((slot, i) => {
    if (slot.kind !== 'month') return;
    const year = Number(slot.month.slice(0, 4));
    if (year !== lastYear) {
      yearLabels.push({ pct: ((i + 0.5) / slots.length) * 100, year });
      lastYear = year;
    }
  });
  const gapMarks = slots
    .map((slot, i) => (slot.kind === 'gap' ? { pct: ((i + 0.5) / slots.length) * 100, slot } : null))
    .filter((g): g is { pct: number; slot: Extract<Slot, { kind: 'gap' }> } => g !== null);

  const first = slots.find((s): s is Extract<Slot, { kind: 'month' }> => s.kind === 'month');
  const last = [...slots].reverse().find((s): s is Extract<Slot, { kind: 'month' }> => s.kind === 'month');
  // Year ticks sit on the January slot (or the first month of that year present in the run).
  const yearTicks: { pct: number; year: number }[] = [];
  let tickYear: number | null = null;
  slots.forEach((slot, i) => {
    if (slot.kind !== 'month') return;
    const year = Number(slot.month.slice(0, 4));
    if (year !== tickYear) {
      yearTicks.push({ pct: (i / slots.length) * 100, year });
      tickYear = year;
    }
  });

  return (
    <figure className={styles.figure}>
      <div className={styles.chart}>
        <svg className={styles.svg} viewBox={`0 0 ${width} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {slots.map((slot, i) => {
            if (slot.kind !== 'month' || slot.count <= 0) return null;
            const h = Math.max(2, (slot.count / max) * (CHART_HEIGHT - 6));
            const x = i * SLOT_WIDTH + (SLOT_WIDTH - BAR_WIDTH) / 2;
            return <rect key={slot.month} x={x} y={CHART_HEIGHT - h} width={BAR_WIDTH} height={h} className={styles.bar} />;
          })}
        </svg>
        {/* One hover/focus target per month slot (HTML, so the tooltip isn't stretched with the
            SVG): shows "Oct 2001 · 11 pages" above the column. CSS-only, server-rendered. */}
        {slots.map((slot, i) => {
          if (slot.kind !== 'month') return null;
          const label = `${monthLabel(slot.month)} · ${slot.count} ${unit}${slot.count === 1 ? '' : 's'}`;
          return (
            <span
              key={slot.month}
              className={`${styles.slot} ${i < slots.length / 2 ? styles.slotLeft : styles.slotRight}`}
              style={{ left: `${(i / slots.length) * 100}%`, width: `${100 / slots.length}%` }}
              tabIndex={slot.count > 0 ? 0 : -1}
              role={slot.count > 0 ? 'img' : undefined}
              aria-label={slot.count > 0 ? label : undefined}
              data-label={label}
            />
          );
        })}
        {gapMarks.map(({ pct, slot }) => (
          <span
            key={`${slot.from}-${slot.to}`}
            className={styles.gapMark}
            style={{ left: `${pct}%` }}
            title={`${slot.span} months with no dated pages (${monthLabel(slot.from)} – ${monthLabel(slot.to)})`}
          >
            ⌇
          </span>
        ))}
      </div>
      <div className={styles.axis} aria-hidden="true">
        {yearTicks.map(t => (
          <span key={t.year} className={styles.tick} style={{ left: `${t.pct}%` }} />
        ))}
        {yearLabels.map(y => (
          <span key={y.year} className={styles.yearLabel} style={{ left: `${y.pct}%` }}>
            {y.year}
          </span>
        ))}
        {first && last && first !== last && (
          <div className={styles.range}>
            <span>{monthLabel(first.month)}</span>
            <span>{monthLabel(last.month)}</span>
          </div>
        )}
      </div>
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
      <table className={styles.srOnlyTable}>
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">{unit.charAt(0).toUpperCase() + unit.slice(1)}s</th>
          </tr>
        </thead>
        <tbody>
          {real.map(d => (
            <tr key={d.month}>
              <td>{monthLabel(d.month)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
