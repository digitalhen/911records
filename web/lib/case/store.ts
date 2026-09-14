'use client';

// The ONLY place that touches storage for the case folder — every component
// (nav badge, save buttons on /doc and /a/[id], the /case page) goes through
// this module's functions, never `localStorage` directly. That's deliberate:
// Henry's 2026-09-14 direction is that user accounts are coming next
// (Better Auth + emailed magic links, modelled on prospect.nyc), and case
// folders will sync to the account then. localStorage is v1's only backing
// store; the account-backed version slots in here later — swap `load`/`save`
// (and `subscribe`, which currently only listens for the `storage` event)
// for authenticated reads/writes against a per-account case-folder endpoint,
// optionally keeping localStorage as an offline cache. No caller outside
// this file should need to change.
//
// Also never imports lib/db.ts (COMMON-web.md: no server import from a
// 'use client' file) — this module never talks to the network today.

import { CASE_STORAGE_KEY, CASE_STORAGE_VERSION, emptyState, itemKey, type CaseFolderState, type CaseItem } from './types';
import type { CaseDocMeta } from './lookup';

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Same-tab reactivity: localStorage's own `storage` event only fires in
 *  *other* tabs, so every write here also notifies same-tab subscribers
 *  directly. An account-backed implementation would notify here too, after
 *  whatever push/poll mechanism it uses observes a remote change. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CASE_STORAGE_KEY) fn();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Reads the whole case folder. */
export function load(): CaseFolderState {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = window.localStorage.getItem(CASE_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<CaseFolderState>;
    if (parsed?.version !== CASE_STORAGE_VERSION || !Array.isArray(parsed.items)) return emptyState();
    return { version: CASE_STORAGE_VERSION, items: parsed.items };
  } catch {
    return emptyState();
  }
}

/** Writes the whole case folder and notifies same-tab subscribers. */
export function save(state: CaseFolderState): boolean {
  try {
    window.localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(state));
    notify();
    return true;
  } catch {
    // Private browsing / storage disabled / quota exceeded — degrade to
    // "changes last until this page closes" rather than throwing.
    notify();
    return false;
  }
}

export function hasPage(doc: string, page: number): boolean {
  const key = itemKey(doc, page);
  return load().items.some((i) => itemKey(i.doc, i.page) === key);
}

export function addPage(item: Omit<CaseItem, 'savedAt' | 'note'>): boolean {
  const state = load();
  const key = itemKey(item.doc, item.page);
  if (state.items.some((i) => itemKey(i.doc, i.page) === key)) return true;
  state.items.push({ ...item, savedAt: new Date().toISOString(), note: '' });
  return save(state);
}

export function removePage(doc: string, page: number): boolean {
  const state = load();
  const key = itemKey(doc, page);
  state.items = state.items.filter((i) => itemKey(i.doc, i.page) !== key);
  return save(state);
}

export function setNote(doc: string, page: number, note: string): boolean {
  const state = load();
  const key = itemKey(doc, page);
  const item = state.items.find((i) => itemKey(i.doc, i.page) === key);
  if (!item) return false;
  item.note = note;
  return save(state);
}

/** Moves the exhibit at `fromIndex` to `toIndex`, keeping everything else in
 *  order — the one reordering primitive; moveUp/moveDown (lib/case/
 *  useCaseFolder.ts) are just `reorder(i, i±1)`, and a future drag-and-drop
 *  UI can call this directly with any target index. */
export function reorder(fromIndex: number, toIndex: number): boolean {
  const state = load();
  if (fromIndex < 0 || fromIndex >= state.items.length || toIndex < 0 || toIndex >= state.items.length) return false;
  const [row] = state.items.splice(fromIndex, 1);
  state.items.splice(toIndex, 0, row!);
  return save(state);
}

export function clear(): boolean {
  return save(emptyState());
}

function docHref(doc: string, page: number): string {
  return page > 1 ? `/doc/${encodeURIComponent(doc)}/p/${page}` : `/doc/${encodeURIComponent(doc)}`;
}

function batesRange(doc: string, batesEnd: string | null | undefined): string {
  if (!batesEnd || batesEnd === doc) return doc;
  return `${doc}–${batesEnd.replace(/^NYC-WTC_/, '')}`;
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

/** The exhibit list export (docs/PLAN.md B6 Part 1): exhibit number, Bates
 *  page, the document's Bates range, our permalink, the City's official PDF
 *  URL and the note, in exhibit order. `meta` is the per-doc refresh from
 *  `/api/case/lookup` (lib/case/lookup.ts) — bates_end/official_url aren't
 *  known client-side at save time. Pure function so both the copy dialog and
 *  the download button build from the same rows. */
export function exportRows(items: CaseItem[], meta: Record<string, CaseDocMeta>, siteUrl: string): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Exhibit', 'Bates page', 'Document Bates range', 'Our permalink', 'Official City URL', 'Note'],
  ];
  items.forEach((item, i) => {
    const m = meta[item.doc];
    rows.push([
      i + 1,
      item.batesPage,
      batesRange(item.doc, m?.bates_end ?? null),
      `${siteUrl}${docHref(item.doc, item.page)}`,
      m?.official_url || '—',
      item.note,
    ]);
  });
  return rows;
}

export function exportCsv(items: CaseItem[], meta: Record<string, CaseDocMeta>, siteUrl: string): string {
  return exportRows(items, meta, siteUrl)
    .map((r) => r.map(csvEscape).join(','))
    .join('\r\n');
}
