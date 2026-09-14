'use client';

import { useCaseFolder } from '@/lib/case/useCaseFolder';

export interface SaveablePage {
  doc: string;
  page: number;
  batesPage: string;
  label: string;
  box?: string | null;
  agency?: string | null;
  volume?: string | null;
}

/** "Save to case" control (docs/PLAN.md B6 Part 1) — on any /doc page and on
 *  every citation on /a/[id]. Purely a localStorage toggle; no network call,
 *  no account. `small` matches the compact buttons used inline in the
 *  source rail vs. the full-size one next to "Cite this page". */
export function SaveToCaseButton({ item, small }: { item: SaveablePage; small?: boolean }) {
  const { has, add, remove } = useCaseFolder();
  const saved = has(item.doc, item.page);

  return (
    <button
      type="button"
      className={`button${small ? ' small' : ''}`}
      aria-pressed={saved}
      onClick={() => {
        if (saved) remove(item.doc, item.page);
        else
          add({
            doc: item.doc,
            page: item.page,
            batesPage: item.batesPage,
            label: item.label,
            box: item.box ?? null,
            agency: item.agency ?? null,
            volume: item.volume ?? null,
          });
      }}
    >
      {saved ? 'Saved to case ✓' : 'Save to case'}
    </button>
  );
}
