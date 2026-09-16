import { getPageBoxes } from '../boxes';
import { queryRead } from '../db';
import { search } from '../opensearch';
import { getDocument, getPage, getPageText } from '../site';

export const backend = {
  search, getDocument, getPage, getPageText, getPageBoxes,
  async availableDocuments(ids: string[]) {
    if (!ids.length) return [];
    // Check Postgres even if the search index has not caught up with a removal.
    return queryRead<{ doc: string }>(
      "SELECT doc FROM site.documents WHERE doc = ANY($1::text[]) AND status IS DISTINCT FROM 'removed'", [ids]);
  },
  async browse(filters: Record<string, string | undefined>, after: string | undefined, limit: number) {
    const params: unknown[] = [];
    const clauses = ["status IS DISTINCT FROM 'removed'"];
    for (const key of ['agency', 'volume', 'box', 'folder'] as const) {
      if (filters[key] !== undefined) { params.push(filters[key]); clauses.push(`${key} = $${params.length}`); }
    }
    if (after) { params.push(after); clauses.push(`doc > $${params.length}`); }
    params.push(limit + 1);
    return queryRead<{ doc: string; agency: string | null; volume: string | null; box: string | null; page_count: number | null }>(
      `SELECT doc, agency, volume, box, page_count FROM site.documents WHERE ${clauses.join(' AND ')} ORDER BY doc LIMIT $${params.length}`, params);
  },
  async changes(since: string | undefined, offset: number, limit: number) {
    // Deliberately return identifiers only, including for removed records.
    return queryRead<{ date: string; doc: string; kind: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, doc, kind FROM site.changes
       WHERE ($1::date IS NULL OR date >= $1::date)
       ORDER BY date DESC, doc, kind LIMIT $2 OFFSET $3`, [since ?? null, limit + 1, offset]);
  },
};
export type Backend = Omit<typeof backend, 'getPageBoxes'> & { getPageBoxes?: typeof getPageBoxes };
