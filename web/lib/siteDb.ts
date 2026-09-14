// Read-only handle on data/site/site.sqlite, the contract file the pipeline
// (build_site_db.py, workstream A2) builds and swaps into place. The schema
// is documented in docs/PLAN.md under "site.sqlite (contract between
// pipeline and app)" — this file must not drift from it without updating
// that doc.
//
// The pipeline writes site.sqlite.tmp and renames over the live file, so the
// app reopens whenever the file's mtime changes rather than caching a handle
// forever. better-sqlite3 is synchronous, which is fine here: every query is
// a single indexed lookup against a small file, never a request-blocking
// scan.
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DATA_DIR } from './paths';

export const SITE_DB_PATH = path.join(DATA_DIR, 'site', 'site.sqlite');

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
  changed_fields: string | null;
  held_locally: number | null;
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
  image_ready: number | null;
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
  fields: string | null;
}

export interface MetaMap {
  built_at: string | null;
  snapshot_date: string | null;
  documents: number | null;
  pages: number | null;
  [key: string]: string | number | null;
}

let db: Database.Database | null = null;
let dbMtimeMs = 0;

function statMtime(): number | null {
  try {
    return fs.statSync(SITE_DB_PATH).mtimeMs;
  } catch {
    return null;
  }
}

/** True as soon as site.sqlite exists on disk, whatever build produced it. */
export function siteDbExists(): boolean {
  return statMtime() !== null;
}

/**
 * Returns a live handle, reopening when the file's mtime has moved since we
 * last opened it (the pipeline's build-then-swap) or on first use. Returns
 * null when the file does not exist yet — callers degrade rather than throw,
 * since site.sqlite may not exist on a fresh checkout until the pipeline (or
 * `npm run fixture-db`, see scripts/fixture-site-db.mjs) has run once.
 */
function getDb(): Database.Database | null {
  const mtime = statMtime();
  if (mtime === null) {
    if (db) {
      db.close();
      db = null;
    }
    return null;
  }
  if (!db || mtime !== dbMtimeMs) {
    if (db) db.close();
    db = new Database(SITE_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');
    dbMtimeMs = mtime;
  }
  return db;
}

export function getMeta(): MetaMap | null {
  const d = getDb();
  if (!d) return null;
  const rows = d.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
  const meta: MetaMap = { built_at: null, snapshot_date: null, documents: null, pages: null };
  for (const r of rows) {
    if (r.key === 'counts') {
      // build_site_db.py writes one JSON blob here (documents, pages, entities, ...).
      try {
        const counts = JSON.parse(r.value) as Record<string, number>;
        meta.documents = counts.documents ?? null;
        meta.pages = counts.pages ?? null;
        meta.counts = r.value;
        for (const [k, v] of Object.entries(counts)) meta[`counts.${k}`] = v;
      } catch {
        meta.counts = r.value;
      }
      continue;
    }
    const isNumeric = r.value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(r.value);
    meta[r.key] = isNumeric ? Number(r.value) : r.value;
  }
  return meta;
}

export function getDocument(doc: string): DocumentRow | null {
  const d = getDb();
  if (!d) return null;
  return (d.prepare('SELECT * FROM documents WHERE doc = ?').get(doc) as DocumentRow | undefined) ?? null;
}

export function getPagesForDoc(doc: string): PageRow[] {
  const d = getDb();
  if (!d) return [];
  return d.prepare('SELECT * FROM pages WHERE doc = ? ORDER BY page').all(doc) as PageRow[];
}

export function getPage(doc: string, page: number): PageRow | null {
  const d = getDb();
  if (!d) return null;
  return (
    (d.prepare('SELECT * FROM pages WHERE doc = ? AND page = ?').get(doc, page) as PageRow | undefined) ?? null
  );
}

export function getLatestSnapshot(): SnapshotRow | null {
  const d = getDb();
  if (!d) return null;
  return (
    (d.prepare('SELECT * FROM snapshots ORDER BY date DESC LIMIT 1').get() as SnapshotRow | undefined) ?? null
  );
}

export function getSnapshots(limit = 12): SnapshotRow[] {
  const d = getDb();
  if (!d) return [];
  return d.prepare('SELECT * FROM snapshots ORDER BY date DESC LIMIT ?').all(limit) as SnapshotRow[];
}

export function getChanges(date?: string, limit = 200): ChangeRow[] {
  const d = getDb();
  if (!d) return [];
  if (date) {
    return d.prepare('SELECT * FROM changes WHERE date = ? ORDER BY doc LIMIT ?').all(date, limit) as ChangeRow[];
  }
  return d.prepare('SELECT * FROM changes ORDER BY date DESC, doc LIMIT ?').all(limit) as ChangeRow[];
}

/** Every doc id, ascending — used by the sitemap generator to page through documents. */
export function getDocIdsPage(offset: number, limit: number): string[] {
  const d = getDb();
  if (!d) return [];
  const rows = d
    .prepare("SELECT doc FROM documents WHERE status != 'removed' ORDER BY doc LIMIT ? OFFSET ?")
    .all(limit, offset) as { doc: string }[];
  return rows.map((r) => r.doc);
}

/** Looks up which document+page a Bates-stamped page belongs to (used by the /page/<bates> redirect). */
export function getPageByBates(bates: string): { doc: string; page: number } | null {
  const d = getDb();
  if (!d) return null;
  const row = d.prepare('SELECT doc, page FROM pages WHERE bates = ? LIMIT 1').get(bates) as
    | { doc: string; page: number }
    | undefined;
  return row ?? null;
}

export function getDocumentCount(): number {
  const d = getDb();
  if (!d) return 0;
  return (d.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n;
}
