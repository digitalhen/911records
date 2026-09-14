// Typed reads against the `site` Postgres schema — the contract between the
// pipeline (build_site_db.py / workstream A2) and this app, documented in
// docs/PLAN.md under "site.sqlite (contract between pipeline and app)" (the
// table names and columns carried over unchanged when that contract moved
// from a shipped SQLite file to a shared Postgres schema; page_text is the
// one new table, added because page OCR text now lives in the database too).
//
// Every query here goes through queryReadSafe, which degrades to an empty
// result (rather than a 500) when a table doesn't exist yet — relevant while
// A2's pipeline is still filling in tables this app doesn't need for day one
// (entities, signatories, topics, places are read by later workstreams).
import { unstable_cache } from 'next/cache';
import { queryRead, queryReadOne, queryReadSafe } from './db';
import { formatDate, type DatabaseDate } from './dates';

export interface DocumentRow {
  doc: string;
  bates_end: string | null;
  agency: string | null;
  source: string | null;
  volume: string | null;
  box: string | null;
  folder: string | null;
  page_count: number | null;
  pdf_size: number | null;
  status: string | null;
  first_seen: DatabaseDate | null;
  removed_at: DatabaseDate | null;
  reappeared_at: DatabaseDate | null;
  changed_at: DatabaseDate | null;
  changed_fields: unknown;
  held_locally: boolean | null;
  pages_ok: number | null;
  pages_empty: number | null;
  pages_ocr: number | null;
  topic: number | null;
  n_related_cross: number | null;
  official_url: string | null;
  /** Rule-based "what is this document" label (issue #28, scripts/embed/doctypes.py) — 'cover_sheet',
   *  'lab_report', 'chain_of_custody', 'memo_letter', 'sign_in_sheet', 'invoice',
   *  'permit_application', 'form', 'photo_log', 'other', or null before the pipeline has
   *  classified this document (or before the column has been loaded at all — getDocument's
   *  `SELECT *` tolerates the column's absence, per docs/briefs/COMMON-web.md's schema-first rule).
   *  Machine-derived; always show it labelled "machine-extracted", never as City metadata. */
  doc_type: string | null;
  doc_type_confidence: number | null;
}

export interface PageRow {
  doc: string;
  page: number;
  bates: string;
  chars: number | null;
  ocr_status: string | null;
  ocr_source: string | null;
  image_ready: boolean | null;
}

export interface PageTextRow {
  doc: string;
  page: number;
  text: string | null;
  source: string | null;
}

export interface SnapshotRow {
  date: DatabaseDate;
  documents: number;
  pages: number;
  bytes: number;
  added: number;
  removed: number;
  changed: number;
  sha256: string | null;
}

export interface ChangeRow {
  date: DatabaseDate;
  doc: string;
  kind: 'added' | 'removed' | 'changed' | 'reappeared';
  fields: unknown;
}

export interface MetaMap {
  built_at: string | null;
  snapshot_date: string | null;
  documents: number | null;
  pages: number | null;
  [key: string]: unknown;
}

/** Always live — used by /api/health and the deploy-verification step (docs/PLAN.md's "verify
 *  buildId inside each container" skew rule), which must never read a cached built_at. Everything
 *  that just wants a cheap, eventually-consistent read of it should go through buildVersion()
 *  below instead. */
export async function getMeta(): Promise<MetaMap | null> {
  const rows = await queryReadSafe<{ key: string; value: string }>('SELECT key, value FROM site.meta');
  if (!rows.length) return null;
  const meta: MetaMap = { built_at: null, snapshot_date: null, documents: null, pages: null };
  for (const r of rows) {
    if (r.key === 'counts') {
      try {
        const counts = JSON.parse(r.value) as Record<string, number>;
        meta.documents = counts.documents ?? null;
        meta.pages = counts.pages ?? null;
        meta.counts = counts;
      } catch {
        meta.counts = r.value;
      }
      continue;
    }
    meta[r.key] = /^-?\d+(\.\d+)?$/.test(r.value) ? Number(r.value) : r.value;
  }
  return meta;
}

// Perf (issue #13): app-level caching for stable, expensive reads, invalidated by a schema swap
// rather than a fixed clock. `cachedMetaRead` puts a 60s TTL under a SEPARATE read of site.meta
// (getMeta() itself stays live, for /api/health) — cheap on its own, but every unstable_cache-
// wrapped read below takes buildVersion()'s return value as part of its cache key, so a refresh
// swap's new site.meta.built_at mints a fresh cache entry right away instead of waiting out a long
// TTL. Net effect: a swap is visible everywhere within this 60s window, and nothing ever serves a
// value computed from a built_at older than the one it would report right now.
const cachedMetaRead = unstable_cache(async () => getMeta(), ['site-meta'], { revalidate: 60 });
/** built_at (or 'unknown' before the pipeline has written meta) — the cache key for every other
 *  cached read in this module and in lib/discovery/data.ts, lib/map/data.ts. */
export async function buildVersion(): Promise<string> {
  const meta = await cachedMetaRead();
  return typeof meta?.built_at === 'string' && meta.built_at ? meta.built_at : 'unknown';
}

export async function getDocument(doc: string): Promise<DocumentRow | null> {
  return queryReadOne<DocumentRow>('SELECT * FROM site.documents WHERE doc = $1', [doc]);
}

export async function getPagesForDoc(doc: string): Promise<PageRow[]> {
  return queryReadSafe<PageRow>('SELECT * FROM site.pages WHERE doc = $1 ORDER BY page', [doc]);
}

export async function getPage(doc: string, page: number): Promise<PageRow | null> {
  return queryReadOne<PageRow>('SELECT * FROM site.pages WHERE doc = $1 AND page = $2', [doc, page]);
}

export async function getPageText(doc: string, page: number): Promise<PageTextRow | null> {
  return queryReadOne<PageTextRow>('SELECT * FROM site.page_text WHERE doc = $1 AND page = $2', [doc, page]);
}

/** Looks up which document+page a Bates-stamped page belongs to (the /page/<bates> redirect). */
export async function getPageByBates(bates: string): Promise<{ doc: string; page: number } | null> {
  return queryReadOne<{ doc: string; page: number }>('SELECT doc, page FROM site.pages WHERE bates = $1 LIMIT 1', [bates]);
}

/**
 * The next document (Bates order) filed in the same agency/volume/box/folder as `doc` — issue #28's
 * cover-sheet banner uses this to point at "the folder's records follow". Groups an untagged folder
 * (NULL agency/volume/box/folder) with its siblings, matching web/lib/info/catalog.ts's `filters()`
 * grouping for /browse. Removed documents are skipped. Only reads columns that have existed since
 * B1 — no schema-first concern here.
 *
 * Perf (issue #13): built as `col = $n` / `col IS NULL` per field, not `col IS NOT DISTINCT FROM
 * $n` — Postgres's planner never turns IS NOT DISTINCT FROM into a btree index condition (verified
 * with EXPLAIN: it stayed a post-scan Filter doing a full Seq Scan even with a matching index), so
 * the old form always missed the documents_browse (agency,volume,box,folder,doc) index below.
 */
export async function getNextInFolder(doc: DocumentRow): Promise<{ doc: string } | null> {
  const fields: [string, string | null][] = [
    ['agency', doc.agency], ['volume', doc.volume], ['box', doc.box], ['folder', doc.folder],
  ];
  const params: unknown[] = [];
  const clauses = fields.map(([col, value]) => {
    if (value === null) return `${col} IS NULL`;
    params.push(value);
    return `${col} = $${params.length}`;
  });
  params.push(doc.doc);
  clauses.push(`doc > $${params.length}`);
  return queryReadOne<{ doc: string }>(
    `SELECT doc FROM site.documents WHERE ${clauses.join(' AND ')} AND status IS DISTINCT FROM 'removed'
     ORDER BY doc LIMIT 1`,
    params,
  );
}

// Perf (issue #13): cached, keyed by buildVersion() (see above) — the home panel's "collection"
// stat block is identical for every visitor between refreshes. Snapshot rows carry a pg DATE
// (`date`), which unstable_cache round-trips through JSON — a raw Date would come back as a full
// ISO timestamp string on a cache hit (breaking formatDate's `instanceof Date` branch and changing
// the rendered text between a cold and warm cache). Pre-formatted to the same 'YYYY-MM-DD' string
// formatDate(Date) already produces, so callers — all of which only ever call formatDate(s.date) —
// see byte-identical output either way.
const cachedLatestSnapshot = unstable_cache(
  async (_v: string) => {
    const row = await queryReadOne<SnapshotRow>('SELECT * FROM site.snapshots ORDER BY date DESC LIMIT 1');
    return row ? { ...row, date: formatDate(row.date) } : null;
  },
  ['site-latest-snapshot'],
  { revalidate: 60 },
);
export async function getLatestSnapshot(): Promise<SnapshotRow | null> {
  return cachedLatestSnapshot(await buildVersion());
}

const cachedSnapshots = unstable_cache(
  async (_v: string, limit: number) => {
    const rows = await queryReadSafe<SnapshotRow>('SELECT * FROM site.snapshots ORDER BY date DESC LIMIT $1', [limit]);
    return rows.map((r) => ({ ...r, date: formatDate(r.date) }));
  },
  ['site-snapshots'],
  { revalidate: 60 },
);
export async function getSnapshots(limit = 12): Promise<SnapshotRow[]> {
  return cachedSnapshots(await buildVersion(), limit);
}

export async function getChanges(date?: string, limit = 200): Promise<ChangeRow[]> {
  if (date) return queryReadSafe<ChangeRow>('SELECT * FROM site.changes WHERE date = $1 ORDER BY doc LIMIT $2', [date, limit]);
  return queryReadSafe<ChangeRow>('SELECT * FROM site.changes ORDER BY date DESC, doc LIMIT $1', [limit]);
}

/** Every non-removed doc id, paged — used by the sitemap generator. */
export async function getDocIdsPage(offset: number, limit: number): Promise<string[]> {
  const rows = await queryReadSafe<{ doc: string }>(
    "SELECT doc FROM site.documents WHERE status IS DISTINCT FROM 'removed' ORDER BY doc LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  return rows.map((r) => r.doc);
}

/** Same paging as getDocIdsPage, plus a <lastmod> candidate (docs/PLAN.md
 *  SEO section: "lastmod on entries where data has dates") — the most
 *  recent of when the doc last changed or was first captured. */
export async function getDocIdsWithDatesPage(offset: number, limit: number): Promise<{ doc: string; lastmod: string | null }[]> {
  const rows = await queryReadSafe<{ doc: string; lastmod: DatabaseDate | null }>(
    `SELECT doc, GREATEST(changed_at, first_seen) AS lastmod FROM site.documents
     WHERE status IS DISTINCT FROM 'removed' ORDER BY doc LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map((r) => ({ doc: r.doc, lastmod: r.lastmod ? formatDate(r.lastmod).slice(0, 10) : null }));
}

const cachedDocumentCount = unstable_cache(
  async (_v: string) => {
    const row = await queryReadOne<{ n: string }>('SELECT COUNT(*) AS n FROM site.documents');
    return row ? Number(row.n) : 0;
  },
  ['site-document-count'],
  { revalidate: 60 },
);
export async function getDocumentCount(): Promise<number> {
  return cachedDocumentCount(await buildVersion());
}

/** True once the pipeline has written at least the documents table — used to distinguish "no data yet" from "query failed". */
export async function siteSchemaReady(): Promise<boolean> {
  const rows = await queryRead<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'site' AND table_name = 'documents') AS exists",
  );
  return rows[0]?.exists ?? false;
}
