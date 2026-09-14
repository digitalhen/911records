'use client';

import { useCallback, useSyncExternalStore } from 'react';
import * as store from './store';
import type { CaseItem } from './types';

/** Reactive read of the case folder plus the mutation helpers every case-
 *  folder UI needs (nav badge, save buttons, /case page). Every call here
 *  goes through lib/case/store.ts, which is the only module that knows
 *  where the folder actually lives (localStorage today; account-backed
 *  sync slots in there later without this hook's API changing). */
const NO_ITEMS: CaseItem[] = [];
const getItems = () => store.load().items;
const getServerItems = () => NO_ITEMS;

export function useCaseFolder() {
  const items = useSyncExternalStore(store.subscribe, getItems, getServerItems);

  return {
    items,
    count: items.length,
    has: useCallback((doc: string, page: number) => items.some((i) => i.doc === doc && i.page === page), [items]),
    add: store.addPage,
    remove: store.removePage,
    updateNote: store.setNote,
    moveUp: (index: number) => store.reorder(index, index - 1),
    moveDown: (index: number) => store.reorder(index, index + 1),
    clear: store.clear,
  };
}
