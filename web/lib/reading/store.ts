// Reads for "What others are reading" (B22, issue #36): the home-panel block,
// the /reading listing and the document-page "Others also read" strip.
// app.reading_seeds and app.doc_views are populated by web/scripts/seed-
// reading.ts and the /api/v beacon respectively (DDL in lib/runtimeSchema.ts).
//
// Anything touching schema `app` reads the PRIMARY, like B3's Ask
// (lib/ask/store.ts) already does — the standby's read-only role has no
// grant on schema `app` (confirmed: queryReadSafe would silently fall back
// to the primary on every single call, logging a warning each time), so
// asking the primary directly is both correct and avoids a wasted round
// trip. queryAppSafe below degrades to "no rows" rather than 500 before
// either table exists yet (COMMON-web.md's "schema first, code second").
// The two site-only lookups inside othersAlsoRead still prefer the standby
// via queryReadSafe, like the rest of the discovery layer.
import 'server-only';
import { query, queryReadSafe, isUndefinedTableError } from '@/lib/db';
import { documentsHaveTitles } from '@/lib/site';
import { isUnsafeReadingTitle } from '@/lib/reading/nameSafety';

async function queryAppSafe<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  try {
    return await query<T>(text, params);
  } catch (err) {
    if (isUndefinedTableError(err)) return [];
    throw err;
  }
}

export interface ReadingItem {
  doc: string;
  title: string;
  /** site.documents.summary (issue #37 follow-up) — live, like title; null before the pipeline has
   *  summarized this document. Not name-safety-filtered like title (see safeReadingItems below):
   *  the summaries pipeline is the same trusted source as title and every other reader of
   *  site.documents.summary (DocumentViewer, /browse, /topics) already shows it unfiltered. */
  summary: string | null;
  why: string;
  group: string;
  rank: number;
  box: string | null;
  agency: string | null;
  folder: string | null;
  views7: number;
}

// Blend: each seed's curated rank contributes a baseline that decays down the
// list (rank 1 worth ~199, rank 100+ worth ~100), and the last-7-day view
// count is added on top so a document that is genuinely being read can rise
// above the editorial order once traffic exists. With near-zero traffic
// (a fresh seed) this reduces to plain rank order, which is the point.
//
// title (issue #37 follow-up): prefers the LIVE site.documents.title over the seed's own stored
// `rs.title` (a snapshot taken when web/scripts/seed-reading.ts last ran, itself already title-
// preferring and name-safety-checked — see that script) — falls back to rs.title so a document the
// summaries pipeline hasn't named yet still shows seed-reading's own safe resolved title rather
// than nothing. Reading d.title BY NAME (not `SELECT *`) is schema-first gated the same way
// lib/site.ts's other callers are, via documentsHaveTitles() — see that function's comment.
async function selectSql(): Promise<string> {
  const hasTitles = await documentsHaveTitles();
  const titleCol = hasTitles ? 'COALESCE(d.title, rs.title)' : 'rs.title';
  const summaryCol = hasTitles ? 'd.summary' : 'NULL::text';
  return `SELECT rs.doc, ${titleCol} AS title, ${summaryCol} AS summary, rs.why, rs."group" AS "group", rs.rank,
    d.box, d.agency, d.folder, COALESCE(v.views7, 0)::int AS views7,
    (COALESCE(v.views7, 0) + GREATEST(0, 200 - rs.rank)) AS blended
  FROM app.reading_seeds rs
  JOIN site.documents d ON d.doc = rs.doc AND d.status IS DISTINCT FROM 'removed' AND d.doc_type IS DISTINCT FROM 'cover_sheet'
  LEFT JOIN (
    SELECT doc, SUM(views)::int AS views7 FROM app.doc_views
    WHERE day >= CURRENT_DATE - INTERVAL '7 days' GROUP BY doc
  ) v ON v.doc = rs.doc`;
}

// Defense in depth (issue #37 follow-up, Henry): web/scripts/seed-reading.ts already refuses to
// WRITE a seed whose resolved title is unsafe, but an existing app.reading_seeds row seeded before
// that fix (or before a reseed picks up a since-improved site.documents.title) must not render its
// old bad title either — filtered here too, at read time, rather than waiting on an operational
// reseed. A filtered-out row simply disappears from the list (never replaced with a fallback that
// might itself be unsafe).
function safeReadingItems(rows: ReadingItem[]): ReadingItem[] {
  return rows.filter((r) => !isUnsafeReadingTitle(r.title));
}

/** Top N seeds overall, blended rank first — the home panel's "What others are reading". */
export async function topReading(limit = 8): Promise<ReadingItem[]> {
  // Over-fetch a little since the safety filter can drop rows below `limit`.
  const rows = await queryAppSafe<ReadingItem>(`${await selectSql()} ORDER BY blended DESC, rs.rank ASC, rs.doc LIMIT $1`, [limit * 2]);
  return safeReadingItems(rows).slice(0, limit);
}

/** All seeded groups, in the fixed editorial group order, each blended-ranked — /reading. */
export async function readingGroups(): Promise<Record<string, ReadingItem[]>> {
  const rows = safeReadingItems(await queryAppSafe<ReadingItem>(`${await selectSql()} ORDER BY blended DESC, rs.rank ASC, rs.doc`));
  const groups: Record<string, ReadingItem[]> = {};
  for (const row of rows) {
    (groups[row.group] ??= []).push(row);
  }
  return groups;
}

export interface AlsoRead {
  doc: string;
  page: number;
  box: string | null;
  folder: string | null;
  /** site.documents.title (issue #37 follow-up) — null before the pipeline has named this
   *  document, or before the column exists at all (documentsHaveTitles() gate below). */
  title: string | null;
  summary: string | null;
  reason: string;
}

/**
 * The document page's "Others also read" strip: the union of documents
 * co-cited with `doc` in an app.answers turn, same-folder neighbours, and
 * site.related rows (the discovery layer's own similarity) — deduplicated,
 * capped at `limit`. Co-citation uses each answer's full retrieved `cites`
 * set (not just the sentences that ended up citing it), the same tolerance
 * RelatedRecords already applies to similarity scores; this is a "readers
 * also found useful" signal, not a citation-validated claim.
 */
export async function othersAlsoRead(doc: string, limit = 5): Promise<AlsoRead[]> {
  // Schema-first (issue #37 follow-up): d.title/d.summary read by name, gated like every other
  // explicit site.documents.title reference in this codebase — see documentsHaveTitles()'s comment.
  const hasTitles = await documentsHaveTitles();
  const titleSelect = (alias: string) => (hasTitles ? `${alias}.title` : 'NULL::text') + ' AS title';
  const summarySelect = (alias: string) => (hasTitles ? `${alias}.summary` : 'NULL::text') + ' AS summary';
  const titleGroupBy = (alias: string) => (hasTitles ? `, ${alias}.title, ${alias}.summary` : '');
  const [coCited, neighbours, related] = await Promise.all([
    queryAppSafe<{ doc: string; page: number; box: string | null; folder: string | null; title: string | null; summary: string | null; n: number }>(
      `SELECT d.doc, p.page, d.box, d.folder, ${titleSelect('d')}, ${summarySelect('d')}, COUNT(*)::int AS n
       FROM app.answers a
       JOIN LATERAL jsonb_array_elements(a.cites) c1 ON (c1->>'doc') = $1
       JOIN LATERAL jsonb_array_elements(a.cites) c2 ON (c2->>'doc') <> $1
       JOIN site.documents d ON d.doc = (c2->>'doc') AND d.status IS DISTINCT FROM 'removed' AND d.doc_type IS DISTINCT FROM 'cover_sheet'
       JOIN LATERAL (SELECT page FROM site.pages WHERE doc = d.doc ORDER BY page LIMIT 1) p ON true
       GROUP BY d.doc, p.page, d.box, d.folder${titleGroupBy('d')} ORDER BY n DESC, d.doc LIMIT $2`,
      [doc, limit],
    ),
    queryReadSafe<{ doc: string; page: number; box: string | null; folder: string | null; title: string | null; summary: string | null }>(
      `SELECT d2.doc, p.page, d2.box, d2.folder, ${titleSelect('d2')}, ${summarySelect('d2')}
       FROM site.documents d1 JOIN site.documents d2
         ON d2.agency = d1.agency AND d2.volume = d1.volume AND d2.box = d1.box
        AND d2.folder = d1.folder AND d2.doc <> d1.doc
       JOIN LATERAL (SELECT page FROM site.pages WHERE doc = d2.doc ORDER BY page LIMIT 1) p ON true
       WHERE d1.doc = $1 AND d1.folder IS NOT NULL AND d2.status IS DISTINCT FROM 'removed' AND d2.doc_type IS DISTINCT FROM 'cover_sheet'
       ORDER BY d2.doc LIMIT $2`,
      [doc, limit],
    ),
    queryReadSafe<{ doc: string; page: number; box: string | null; folder: string | null; title: string | null; summary: string | null }>(
      `SELECT d.doc, p.page, d.box, d.folder, ${titleSelect('d')}, ${summarySelect('d')}
       FROM site.related r JOIN site.documents d ON d.doc = r.other
       JOIN LATERAL (SELECT page FROM site.pages WHERE doc = d.doc ORDER BY page LIMIT 1) p ON true
       WHERE r.doc = $1 AND r.other <> r.doc AND d.status IS DISTINCT FROM 'removed' AND d.doc_type IS DISTINCT FROM 'cover_sheet'
       ORDER BY r.rank ASC NULLS LAST, r.score DESC LIMIT $2`,
      [doc, limit],
    ),
  ]).catch(() => [[], [], []] as const);

  // Same defense-in-depth as topReading()/readingGroups() above: never surface an unsafe title
  // (a name, or the portal watermark), even a live site.documents.title, on this strip. Summary is
  // not filtered the same way — see the AlsoRead.summary field comment above.
  const safeTitle = (t: string | null) => (t && !isUnsafeReadingTitle(t) ? t : null);
  const byDoc = new Map<string, AlsoRead>();
  for (const row of coCited) {
    if (!byDoc.has(row.doc)) byDoc.set(row.doc, { doc: row.doc, page: row.page, box: row.box, folder: row.folder, title: safeTitle(row.title), summary: row.summary, reason: 'Cited alongside this record in an Ask answer' });
  }
  for (const row of neighbours) {
    if (row.doc !== doc && !byDoc.has(row.doc)) byDoc.set(row.doc, { doc: row.doc, page: row.page, box: row.box, folder: row.folder, title: safeTitle(row.title), summary: row.summary, reason: 'Filed in the same folder' });
  }
  for (const row of related) {
    if (row.doc !== doc && !byDoc.has(row.doc)) byDoc.set(row.doc, { doc: row.doc, page: row.page, box: row.box, folder: row.folder, title: safeTitle(row.title), summary: row.summary, reason: 'Similar indexed content' });
  }
  return [...byDoc.values()].slice(0, limit);
}
