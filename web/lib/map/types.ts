export type RecordKind = 'test' | 'inspection' | 'mention';
export interface Place {
  id: string; kind: string; key: string; label: string;
  n_docs: number; n_pages: number; n_test_pages: number; n_inspection_pages: number;
  first_date: string | null; last_date: string | null; lat: number | null; lon: number | null;
  doc: string; page: number; confidence: number | null;
}
export interface Candidate {
  doc: string; page: number; agency: string | null; box: string | null; volume: string | null;
  has_test: boolean; inspection: boolean; contaminants: string[]; units: string[];
  dates: string[]; labs: string[]; confidence: number | null; measurements: string[];
  /** Plain-language document title (issue #37, scripts/embed/summaries.py), or null. */
  title: string | null;
  /** One-sentence summary (<=180 chars) paired with `title`, or null under the same conditions. */
  summary: string | null;
}
export interface BuildingFacts {
  bbl: string; bin: string | null; year_built: number | null; num_floors: number | null;
  units_res: number | null; units_total: number | null; bldg_area: string | number | null;
  bldg_class: string | null; num_bldgs: number | null; source: string | null;
}
export interface PlaceFile { place: Place; rows: Candidate[]; related: Place[]; facts: BuildingFacts | null }
export interface MapFilters { substance: string; from: number; to: number; type: string; only: boolean }
export const DEFAULT_FILTERS: MapFilters = { substance: '', from: 0, to: 27, type: '', only: false };
export const COLORS = { test: '#315f91', inspection: '#668873', mention: '#bba578', ground: '#dce0df' };
// Map ground: water is the canvas background; land is the existing paper tone
// (unchanged, so footprints/streets keep their contrast); shoreline is a
// hairline a shade darker than land, drawn on the land polygons' edges.
export const MAP_GROUND = { water: '#c7d3d6', land: '#f0f2ef', shoreline: '#aebcc0' };
export function buildingUrl(p: Pick<Place, 'kind' | 'key' | 'id'>) {
  return `/building/${encodeURIComponent(p.kind === 'bin' ? p.key : p.id)}`;
}
export function pageUrl(p: { doc: string; page: number }) { return `/doc/${encodeURIComponent(p.doc)}/p/${p.page}`; }
// Shared with web/scripts/check-suggestions.ts (B15) so the map panel's
// data-driven "question" chip and its results-check stay byte-identical —
// see MapExplorer.tsx's comment for why this doesn't name a fixed date.
export function placeQuestion(label: string) { return `What test records exist for ${label}?`; }
export function substanceQuestion(substance: string) { return `Which buildings have ${substance} test records?`; }
export function month(index: number) { return new Date(Date.UTC(2001, 8 + index, 1)).toISOString().slice(0, 7); }
export function recordKind(p: Place): RecordKind { return p.n_test_pages > 0 ? 'test' : p.n_inspection_pages > 0 ? 'inspection' : 'mention'; }
// A route param may arrive still percent-encoded (observed: Next.js app router does not always
// decode a dynamic segment containing a reserved character such as ':'). Decode once, tolerantly.
export function decodeId(raw: string): string { try { return decodeURIComponent(raw); } catch { return raw; } }
// PLUTO building-class first-letter categories (NYC DOF); decode only the obvious, common ones.
const BLDG_CLASS_CATEGORIES: Record<string, string> = {
  A: 'one-family home', B: 'two-family home', C: 'walk-up apartments', D: 'elevator apartments',
  E: 'warehouse', F: 'factory / industrial', G: 'garage', H: 'hotel', I: 'hospital / health facility',
  J: 'theater', K: 'store building', L: 'loft building', M: 'religious facility', N: 'asylum / home',
  O: 'office', P: 'indoor public assembly', Q: 'outdoor recreation', R: 'condominium',
  S: 'residential with commercial', T: 'transportation facility', U: 'utility', V: 'vacant land',
  W: 'educational facility', Y: 'government building', Z: 'miscellaneous',
};
export function decodeBldgClass(code: string | null): string | null {
  if (!code) return null;
  const category = BLDG_CLASS_CATEGORIES[code.charAt(0).toUpperCase()];
  return category ? `${category} (${code})` : code;
}
