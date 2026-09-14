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
import { queryRead, queryReadOne, queryReadSafe } from './db';

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
  first_seen: string | null;
  removed_at: string | null;
  reappeared_at: string | null;
  changed_at: string | null;
  changed_fields: unknown;
  held_locally: boolean | null;
  pages_ok: number | null;
  pages_empty: number | null;
  pages_ocr: number | null;
  topic: number | null;
  n_related_cross: number | null;
  official_url: string | null;
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
  date: string;
  documents: number;
  pages: number;
  bytes: number;
  added: number;
  removed: number;
  changed: number;
  sha256: string | null;
}

export interface ChangeRow {
  date: string;
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

export async function getLatestSnapshot(): Promise<SnapshotRow | null> {
  return queryReadOne<SnapshotRow>('SELECT * FROM site.snapshots ORDER BY date DESC LIMIT 1');
}

export async function getSnapshots(limit = 12): Promise<SnapshotRow[]> {
  return queryReadSafe<SnapshotRow>('SELECT * FROM site.snapshots ORDER BY date DESC LIMIT $1', [limit]);
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

export async function getDocumentCount(): Promise<number> {
  const row = await queryReadOne<{ n: string }>('SELECT COUNT(*) AS n FROM site.documents');
  return row ? Number(row.n) : 0;
}

/** True once the pipeline has written at least the documents table — used to distinguish "no data yet" from "query failed". */
export async function siteSchemaReady(): Promise<boolean> {
  const rows = await queryRead<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'site' AND table_name = 'documents') AS exists",
  );
  return rows[0]?.exists ?? false;
}
