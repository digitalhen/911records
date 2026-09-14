'use client';

// Plain localStorage read/write for the case folder, plus a tiny same-tab
// event bus so every component reading the folder (nav badge, /case page,
// "Save to case" buttons scattered across /doc and /a/[id]) re-renders the
// instant one of them writes — the browser's own `storage` event only fires
// in *other* tabs. Never imports lib/db.ts (COMMON-web.md: no server import
// from a 'use client' file); this module never talks to the network.

import { CASE_STORAGE_KEY, CASE_STORAGE_VERSION, emptyState, itemKey, type CaseFolderState, type CaseItem } from './types';

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

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

export function readState(): CaseFolderState {
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

function writeState(state: CaseFolderState): boolean {
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

export function hasItem(doc: string, page: number): boolean {
  const key = itemKey(doc, page);
  return readState().items.some((i) => itemKey(i.doc, i.page) === key);
}

export function addItem(item: Omit<CaseItem, 'savedAt' | 'note'>): boolean {
  const state = readState();
  const key = itemKey(item.doc, item.page);
  if (state.items.some((i) => itemKey(i.doc, i.page) === key)) return true;
  state.items.push({ ...item, savedAt: new Date().toISOString(), note: '' });
  return writeState(state);
}

export function removeItem(doc: string, page: number): boolean {
  const state = readState();
  const key = itemKey(doc, page);
  state.items = state.items.filter((i) => itemKey(i.doc, i.page) !== key);
  return writeState(state);
}

export function updateNote(doc: string, page: number, note: string): boolean {
  const state = readState();
  const key = itemKey(doc, page);
  const item = state.items.find((i) => itemKey(i.doc, i.page) === key);
  if (!item) return false;
  item.note = note;
  return writeState(state);
}

export function move(index: number, direction: -1 | 1): boolean {
  const state = readState();
  const target = index + direction;
  if (index < 0 || index >= state.items.length || target < 0 || target >= state.items.length) return false;
  const [row] = state.items.splice(index, 1);
  state.items.splice(target, 0, row!);
  return writeState(state);
}

export function clear(): boolean {
  return writeState(emptyState());
}
