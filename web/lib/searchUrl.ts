// Builds /search URLs that add, replace or clear one param while keeping the
// rest of the current query string — the mechanism behind every facet link
// and the pager, so the whole results page works with no client JS.
export const FILTER_KEYS = ['agency', 'source', 'box', 'folder', 'volume', 'contaminant', 'lab', 'address', 'year'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type SearchParamsInput = Record<string, string | string[] | undefined>;

function toParams(sp: SearchParamsInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v[0] !== undefined) params.set(k, v[0]);
    } else {
      params.set(k, v);
    }
  }
  return params;
}

export function searchHref(sp: SearchParamsInput, overrides: Record<string, string | null>): string {
  const params = toParams(sp);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  // Any filter/query change resets pagination.
  if (!('page' in overrides)) params.delete('page');
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

export function getStr(sp: SearchParamsInput, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** OpenSearch stops counting at 10,000 hits, so a capped total reads "10,000+" rather than as an
 *  exact figure (2026-09-14). */
export function formatTotal(total: number): string {
  return total >= 10000 ? '10,000+' : total.toLocaleString();
}
