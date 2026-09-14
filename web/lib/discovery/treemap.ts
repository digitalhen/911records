// Squarified treemap layout (Bruls/Huizing/van Wijk) computed server-side —
// no chart library. Coordinates are returned in the same units passed in
// (callers use a 1000x500 virtual box and render rects as CSS percentages,
// so the layout stays fluid at any container width).
export interface TreemapInput<T> { size: number; data: T }
export interface TreemapRect<T> { x: number; y: number; w: number; h: number; data: T }

function worstRatio(row: { area: number }[], side: number): number {
  if (!row.length || side <= 0) return Infinity;
  const sum = row.reduce((s, r) => s + r.area, 0);
  const max = Math.max(...row.map((r) => r.area));
  const min = Math.min(...row.map((r) => r.area));
  if (sum <= 0 || min <= 0) return Infinity;
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

function layout<T>(items: { area: number; data: T }[], x: number, y: number, w: number, h: number, out: TreemapRect<T>[]): void {
  if (!items.length || w <= 0 || h <= 0) return;
  if (items.length === 1) { out.push({ x, y, w, h, data: items[0]!.data }); return; }
  const shortSide = Math.min(w, h);
  let i = 1;
  while (i < items.length && worstRatio(items.slice(0, i), shortSide) >= worstRatio(items.slice(0, i + 1), shortSide)) i++;
  const row = items.slice(0, i);
  const rest = items.slice(i);
  const rowArea = row.reduce((s, r) => s + r.area, 0);
  if (w >= h) {
    const colWidth = rowArea / h;
    let cy = y;
    for (const item of row) {
      const itemHeight = item.area / colWidth;
      out.push({ x, y: cy, w: colWidth, h: itemHeight, data: item.data });
      cy += itemHeight;
    }
    layout(rest, x + colWidth, y, w - colWidth, h, out);
  } else {
    const rowHeight = rowArea / w;
    let cx = x;
    for (const item of row) {
      const itemWidth = item.area / rowHeight;
      out.push({ x: cx, y, w: itemWidth, h: rowHeight, data: item.data });
      cx += itemWidth;
    }
    layout(rest, x, y + rowHeight, w, h - rowHeight, out);
  }
}

/** Lays out `items` (sized by `.size`, largest first) inside a width x height box. Zero/negative sizes are dropped. */
export function squarify<T>(items: TreemapInput<T>[], width: number, height: number): TreemapRect<T>[] {
  const usable = items.filter((i) => i.size > 0);
  const total = usable.reduce((s, i) => s + i.size, 0);
  if (!usable.length || total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const sized = [...usable].sort((a, b) => b.size - a.size).map((i) => ({ area: i.size * scale, data: i.data }));
  const out: TreemapRect<T>[] = [];
  layout(sized, 0, 0, width, height, out);
  return out;
}

// Seven muted, non-red hues — cycled by a topic's root-ancestor index so every
// box that traces back to the same top-level subject reads as one family.
export const TOPIC_PALETTE = ['#274d6e', '#3f6c52', '#5a4a7a', '#3a6b6b', '#6b5a3a', '#4a5a7a', '#5a6b3a'] as const;

export function topicColor(rootIndex: number): string {
  return TOPIC_PALETTE[((rootIndex % TOPIC_PALETTE.length) + TOPIC_PALETTE.length) % TOPIC_PALETTE.length] ?? TOPIC_PALETTE[0];
}

/** Walks a topic's `parent` chain to its top-level ancestor id (guards against cycles/missing rows). */
export function rootAncestorId(id: number, parentOf: Map<number, number | null>): number {
  let cur = id;
  const seen = new Set<number>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const parent = parentOf.get(cur);
    if (parent == null || !parentOf.has(parent) || parent === cur) return cur;
    cur = parent;
  }
  return cur;
}
