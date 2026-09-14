// Server-only account-backed case folder storage (issue #21). Mirrors the
// shape of lib/case/lookup.ts: only ever imported from app/api/case/*
// route handlers, never from a 'use client' file (COMMON-web.md). Backing
// table is app.case_folders (lib/runtimeSchema.ts) — one row per saved
// page, replaced wholesale on every sync rather than diffed, since a case
// folder is at most a few hundred rows and full-replace can't drift out of
// sync with what the client actually holds.
import { queryReadSafe, withTransaction } from '@/lib/db';
import type { CaseItem } from './types';

const MAX_ITEMS = 500;

interface CaseFolderRow {
  doc: string;
  page: number;
  bates_page: string;
  label: string;
  box: string | null;
  agency: string | null;
  volume: string | null;
  note: string;
  saved_at: string;
}

export async function loadCaseFolder(userId: string): Promise<CaseItem[]> {
  const rows = await queryReadSafe<CaseFolderRow>(
    `SELECT doc, page, bates_page, label, box, agency, volume, note, saved_at
     FROM app.case_folders WHERE user_id = $1 ORDER BY sort_order ASC`,
    [userId],
  );
  return rows.map((r) => ({
    doc: r.doc,
    page: r.page,
    batesPage: r.bates_page,
    label: r.label,
    box: r.box,
    agency: r.agency,
    volume: r.volume,
    note: r.note,
    savedAt: new Date(r.saved_at).toISOString(),
  }));
}

/** Replaces the whole account-backed folder with `items`, in order. Caps at
 *  MAX_ITEMS (matching lib/case/lookup.ts's lookupDocs cap) — a client
 *  sending more than that has a bug, not a legitimate case folder. */
export async function saveCaseFolder(userId: string, items: CaseItem[]): Promise<void> {
  const capped = items.slice(0, MAX_ITEMS);
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM app.case_folders WHERE user_id = $1`, [userId]);
    for (const [i, item] of capped.entries()) {
      await client.query(
        `INSERT INTO app.case_folders (user_id, doc, page, bates_page, label, box, agency, volume, note, sort_order, saved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          userId,
          item.doc,
          item.page,
          item.batesPage,
          item.label || '',
          item.box ?? null,
          item.agency ?? null,
          item.volume ?? null,
          item.note || '',
          i,
          item.savedAt || new Date().toISOString(),
        ],
      );
    }
  });
}
