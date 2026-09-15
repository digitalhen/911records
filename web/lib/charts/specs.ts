// Vega-Lite specs (pure functions over already-loaded rows). Rendered on the server by
// components/charts/VegaChart. All counts are pages by extracted date, never measurements.
import type { VlSpec } from './vega';
import type { WeekFamily, MonthCell, FirstTested } from './timeline';

const MONTH_AXIS = { field: 'month', type: 'ordinal', title: null, axis: { labelAngle: 0, labelExpr: "slice(datum.value, 5) == '01' || datum.index == 0 ? slice(datum.value, 0, 4) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][toNumber(slice(datum.value, 5)) - 1] : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][toNumber(slice(datum.value, 5)) - 1]", labelOverlap: 'parity' } } as const;

/** Test candidate pages per week, stacked by substance family. */
export function pagesByWeekSpec(rows: WeekFamily[]): VlSpec {
  return {
    data: { values: rows },
    height: 220,
    mark: { type: 'bar', width: { band: 0.9 } },
    encoding: {
      x: { field: 'week', type: 'temporal', timeUnit: 'yearweek', title: null, axis: { format: '%b %Y', tickCount: 'month', labelOverlap: 'parity', grid: false } },
      y: { field: 'pages', type: 'quantitative', aggregate: 'sum', title: 'test candidate pages per week' },
      color: { field: 'family', type: 'nominal', title: 'Substance family', sort: ['asbestos (all forms)', 'dust, debris and fibres', 'lead', 'other metals', 'organics (PCBs, dioxins, VOCs)', 'other'], legend: { orient: 'top', columns: 3, direction: 'horizontal', labelLimit: 260, columnPadding: 18 } },
      order: { field: 'family', sort: 'ascending' },
      description: { field: 'pages', type: 'quantitative', format: ',' },
      tooltip: [{ field: 'week', type: 'temporal', title: 'Week of', format: '%d %b %Y' }, { field: 'family', title: 'Family' }, { field: 'pages', title: 'Pages' }, { field: 'buildings', title: 'Buildings' }],
    },
  } as VlSpec;
}

/** Cumulative count of buildings by the week of their first dated test page. */
export function buildingsFirstTestedSpec(rows: FirstTested[]): VlSpec {
  return {
    data: { values: rows },
    height: 160,
    transform: [{ sort: [{ field: 'week' }], window: [{ op: 'sum', field: 'buildings', as: 'cumulative' }], frame: [null, 0] }],
    layer: [
      { mark: { type: 'area', color: 'var(--blue-tint)', line: { color: 'var(--blue)', strokeWidth: 1.5 }, interpolate: 'step-after' } },
      { mark: { type: 'circle', size: 18, color: 'var(--blue)' }, encoding: { description: { field: 'cumulative', type: 'quantitative' } } },
    ],
    encoding: {
      x: { field: 'week', type: 'temporal', title: null, axis: { format: '%b %Y', tickCount: 'month', labelOverlap: 'parity', grid: false } },
      y: { field: 'cumulative', type: 'quantitative', title: 'buildings' },
      tooltip: [{ field: 'week', type: 'temporal', title: 'Week of', format: '%d %b %Y' }, { field: 'buildings', title: 'First tested this week' }, { field: 'cumulative', title: 'Buildings so far' }],
    },
  } as VlSpec;
}

/** Substance × month heatmap; each cell links to the search page filtered to that substance and year. */
export function substanceMonthSpec(rows: MonthCell[]): VlSpec {
  const values = rows.map((r) => ({ ...r, href: `/search?contaminant=${encodeURIComponent(r.key)}&year=${r.year}` }));
  return heatmap(values, 'Substance', 'pages');
}

/** Lab × month heatmap; each cell links to the lab's own page. */
export function labMonthSpec(rows: MonthCell[]): VlSpec {
  const values = rows.map((r) => ({ ...r, href: `/entity/lab/${encodeURIComponent(r.key.replace(/^lab:/, ''))}` }));
  return heatmap(values, 'Lab', 'pages');
}

function heatmap(values: Array<MonthCell & { href: string }>, rowTitle: string, field: string): VlSpec {
  return {
    data: { values },
    mark: { type: 'rect', stroke: 'var(--paper)', strokeWidth: 1 },
    height: { step: 18 },
    encoding: {
      x: MONTH_AXIS,
      y: { field: 'label', type: 'nominal', title: null, sort: { op: 'sum', field, order: 'descending' }, axis: { labelLimit: 200 } },
      color: { field, type: 'quantitative', scale: { type: 'sqrt', range: ['#dfe7f3', '#142c3d'] }, title: 'pages', legend: { orient: 'bottom', direction: 'horizontal', gradientLength: 160 } },
      href: { field: 'href' },
      description: { field, type: 'quantitative' },
      tooltip: [{ field: 'label', title: rowTitle }, { field: 'month', title: 'Month' }, { field, title: 'Pages' }],
    },
  } as VlSpec;
}

/** A building's test candidate pages: substance rows × date, dot size = pages that day. */
export interface BuildingTestRow { doc: string; page: number; dates: string[]; contaminants: string[]; labs: string[] }
export function buildingTestsSpec(rows: BuildingTestRow[]): VlSpec | null {
  const cells = new Map<string, { date: string; substance: string; pages: Set<string>; labs: Set<string> }>();
  for (const r of rows) {
    for (const d of r.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      for (const c of r.contaminants.length ? r.contaminants : ['(unspecified)']) {
        const k = `${d}|${c}`;
        const cell = cells.get(k) ?? { date: d, substance: c, pages: new Set<string>(), labs: new Set<string>() };
        cell.pages.add(`${r.doc}:${r.page}`); for (const l of r.labs) cell.labs.add(l);
        cells.set(k, cell);
      }
    }
  }
  const values0 = [...cells.values()];
  if (cells.size < 2 || new Set(values0.map((c) => c.date)).size < 2) return null;
  const values = [...cells.values()].map((c) => ({ date: c.date, substance: c.substance, pages: c.pages.size, labs: [...c.labs].join(', ') || '—' }));
  const substances = [...new Set(values.map((v) => v.substance))].length;
  return {
    data: { values },
    height: { step: 20 },
    mark: { type: 'circle', opacity: 0.85, color: 'var(--blue)' },
    encoding: {
      x: { field: 'date', type: 'temporal', title: null, axis: { format: '%b %Y', labelOverlap: 'parity', grid: true, tickCount: substances > 6 ? 'month' : 6 } },
      y: { field: 'substance', type: 'nominal', title: null, sort: { op: 'sum', field: 'pages', order: 'descending' } },
      size: { field: 'pages', type: 'quantitative', title: 'pages', scale: { range: [30, 400] }, legend: { orient: 'bottom', direction: 'horizontal', tickMinStep: 1, format: 'd' } },
      description: { field: 'pages', type: 'quantitative' },
      tooltip: [{ field: 'date', type: 'temporal', title: 'Date', format: '%d %b %Y' }, { field: 'substance', title: 'Substance' }, { field: 'pages', title: 'Pages' }, { field: 'labs', title: 'Labs named' }],
    },
  } as VlSpec;
}

/** An entity's dated pages per month, stacked by the agency whose files they sit in. */
export function monthsByAgencySpec(rows: Array<{ month: string; agency: string; pages: number }>): VlSpec | null {
  if (rows.length < 2) return null;
  return {
    data: { values: rows },
    height: 140,
    mark: { type: 'bar', width: { band: 0.8 } },
    encoding: {
      x: { field: 'month', type: 'temporal', timeUnit: 'yearmonth', title: null, axis: { format: '%b %Y', labelOverlap: 'parity', grid: false } },
      y: { field: 'pages', type: 'quantitative', title: 'pages', aggregate: 'sum' },
      color: { field: 'agency', type: 'nominal', title: null, legend: { orient: 'top', direction: 'horizontal', columns: 2, labelLimit: 360 } },
      description: { field: 'pages', type: 'quantitative' },
      tooltip: [{ field: 'month', title: 'Month' }, { field: 'agency', title: 'Agency' }, { field: 'pages', title: 'Pages' }],
    },
  } as VlSpec;
}
