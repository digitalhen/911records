// Server-side Vega-Lite → SVG. Charts are rendered on the server so pages ship no chart
// JavaScript; colours are CSS variables (the SVG inherits the page theme, light or dark).
// Never import from a 'use client' component.
import * as vega from 'vega';
import * as vl from 'vega-lite';

export type VlSpec = vl.TopLevelSpec;

/** Categorical palette: ink-adjacent hues from the site's own tokens, readable on both grounds. */
export const CATEGORY = ['#214fbb', '#84601d', '#346253', '#854437', '#6b7f99', '#b08a4a', '#5f8a7c', '#a97b70', '#8c98a4', '#3d6bd6'];

const CONFIG: NonNullable<VlSpec['config']> = {
  font: 'Arial, Helvetica, sans-serif',
  background: 'transparent',
  view: { stroke: null },
  axis: {
    labelColor: 'var(--muted)', titleColor: 'var(--muted)', domainColor: 'var(--line)', tickColor: 'var(--line)',
    gridColor: 'var(--soft)', labelFontSize: 11, titleFontSize: 11, titleFontWeight: 'normal', titlePadding: 8,
  },
  legend: { labelColor: 'var(--ink)', titleColor: 'var(--muted)', labelFontSize: 11, titleFontSize: 11, titleFontWeight: 'normal', symbolSize: 80 },
  header: { labelColor: 'var(--ink)', titleColor: 'var(--muted)', labelFontSize: 11, titleFontSize: 11 },
  title: { color: 'var(--ink)', fontSize: 13, fontWeight: 'normal', anchor: 'start' },
  range: { category: CATEGORY, ordinal: { scheme: 'blues' } },
};

/** Vega's SVG renderer writes a mark's `description` as aria-label only. Browsers show a
 * <title> child on hover, so lift each aria-label into one: native tooltips, no script. */
function titlesFromAriaLabels(svg: string): string {
  return svg
    .replace(/<(path|rect|circle|line)([^>]*?) aria-label="([^"]*)"([^>]*?)\/>/g, '<$1$2$4><title>$3</title></$1>')
    .replace(/<(path|rect|circle|line)([^>]*?) aria-label="([^"]*)"([^>]*?)>(?!<title)/g, '<$1$2$4><title>$3</title>');
}

/** Render a Vega-Lite spec to an SVG string sized to `width` CSS px (scales down with viewBox). */
export async function renderVegaLite(spec: VlSpec, width = 860): Promise<string> {
  const withConfig: VlSpec = { ...spec, config: { ...CONFIG, ...(spec.config ?? {}) } } as VlSpec;
  if (!('vconcat' in withConfig) && !('hconcat' in withConfig) && !('concat' in withConfig)) {
    (withConfig as { width?: number | 'container' }).width = (withConfig as { width?: number }).width ?? width;
  }
  const compiled = vl.compile(withConfig).spec;
  const view = new vega.View(vega.parse(compiled), { renderer: 'none' });
  const svg = await view.toSVG();
  view.finalize();
  return titlesFromAriaLabels(svg).replace(/<rect width="\d+" height="\d+" fill="transparent"\/>/, '');
}
