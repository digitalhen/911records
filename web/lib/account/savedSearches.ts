// Server-only saved-search storage (issue #21 / docs/PLAN.md "Accounts").
// Only imported from app/api/saved-searches/* route handlers, never from a
// 'use client' file (COMMON-web.md). Backing table: app.saved_searches
// (lib/runtimeSchema.ts). web/scripts/digest.ts reads the same table
// directly (it runs outside the Next.js process) rather than importing
// this module, to stay a plain standalone script.
import { randomUUID } from 'crypto';
import { query, queryReadSafe } from '@/lib/db';

const MAX_PER_USER = 25;
const MAX_LABEL = 200;
const MAX_PARAMS = 1000;

export interface SavedSearch {
  id: string;
  label: string;
  params: string;
  createdAt: string;
  lastCheckedAt: string | null;
  lastSeenCount: number;
}

interface SavedSearchRow {
  id: string;
  label: string;
  params: string;
  created_at: string;
  last_checked_at: string | null;
  last_seen_count: number;
}

function toSavedSearch(r: SavedSearchRow): SavedSearch {
  return {
    id: r.id,
    label: r.label,
    params: r.params,
    createdAt: new Date(r.created_at).toISOString(),
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
    lastSeenCount: r.last_seen_count,
  };
}

export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  const rows = await queryReadSafe<SavedSearchRow>(
    `SELECT id, label, params, created_at, last_checked_at, last_seen_count
     FROM app.saved_searches WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toSavedSearch);
}

export class SavedSearchLimitError extends Error {}

/** `params` is the /search query string with `page` stripped (a saved
 *  search is the query + filters, not a page number) — the caller
 *  (app/api/saved-searches/route.ts) does that stripping before calling in,
 *  keeping URLSearchParams parsing out of this module. */
export async function createSavedSearch(userId: string, label: string, params: string): Promise<SavedSearch> {
  const existing = await query<{ n: string }>(`SELECT count(*)::text AS n FROM app.saved_searches WHERE user_id = $1`, [userId]);
  if (Number(existing[0]?.n ?? 0) >= MAX_PER_USER) {
    throw new SavedSearchLimitError(`Up to ${MAX_PER_USER} saved searches per account`);
  }
  const id = randomUUID();
  const rows = await query<SavedSearchRow>(
    `INSERT INTO app.saved_searches (id, user_id, label, params)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, params, created_at, last_checked_at, last_seen_count`,
    [id, userId, label.slice(0, MAX_LABEL) || 'Saved search', params.slice(0, MAX_PARAMS)],
  );
  return toSavedSearch(rows[0]!);
}

/** No-op (doesn't throw) if `id` doesn't belong to `userId` — the route
 *  handler doesn't need to distinguish "already gone" from "not yours". */
export async function deleteSavedSearch(userId: string, id: string): Promise<void> {
  await query(`DELETE FROM app.saved_searches WHERE id = $1 AND user_id = $2`, [id, userId]);
}
