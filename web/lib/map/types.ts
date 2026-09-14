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
}
export interface PlaceFile { place: Place; rows: Candidate[]; related: Place[] }
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
export function month(index: number) { return new Date(Date.UTC(2001, 8 + index, 1)).toISOString().slice(0, 7); }
export function recordKind(p: Place): RecordKind { return p.n_test_pages > 0 ? 'test' : p.n_inspection_pages > 0 ? 'inspection' : 'mention'; }
