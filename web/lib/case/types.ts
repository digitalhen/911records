// Case folder (docs/PLAN.md B6, `/case`): entirely browser-local, no accounts.
// One localStorage key, versioned, so a future shape change can migrate
// instead of silently discarding a visitor's saved pages.

export const CASE_STORAGE_KEY = 'case-folder-v1';
export const CASE_STORAGE_VERSION = 1;

/** A saved page — the minimal fields known at save time, without a DB round
 *  trip. lib/case/lookup.ts refreshes the rest (bates_end, official_url,
 *  current status) when the case page renders. */
export interface CaseItem {
  doc: string;
  page: number;
  /** Bates stamp of this specific saved page, e.g. "NYC-WTC_900058160". */
  batesPage: string;
  /** Best label available at save time (folder name, or the doc id). */
  label: string;
  box: string | null;
  agency: string | null;
  volume: string | null;
  /** ISO timestamp. */
  savedAt: string;
  note: string;
}

export interface CaseFolderState {
  version: typeof CASE_STORAGE_VERSION;
  items: CaseItem[];
}

export function emptyState(): CaseFolderState {
  return { version: CASE_STORAGE_VERSION, items: [] };
}

export function itemKey(doc: string, page: number): string {
  return `${doc}:${page}`;
}
