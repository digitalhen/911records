'use client';

import { useCallback, useSyncExternalStore } from 'react';
import * as store from './store';
import type { CaseItem } from './types';

/** Reactive read of the case folder plus the mutation helpers every case-
 *  folder UI needs (nav badge, save buttons, /case page). Backed by
 *  localStorage; `subscribe` fires on any tab's write. */
export function useCaseFolder() {
  const items = useSyncExternalStore(store.subscribe, () => store.readState().items, () => [] as CaseItem[]);

  return {
    items,
    count: items.length,
    has: useCallback((doc: string, page: number) => items.some((i) => i.doc === doc && i.page === page), [items]),
    add: store.addItem,
    remove: store.removeItem,
    updateNote: store.updateNote,
    moveUp: (index: number) => store.move(index, -1),
    moveDown: (index: number) => store.move(index, 1),
    clear: store.clear,
  };
}
