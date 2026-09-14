#!/usr/bin/env node
// Dev-only fixture: builds data/site/site.sqlite from data/manifest.jsonl and
// data/embed/*.sqlite so the app has something to read before the real
// pipeline (build_site_db.py, workstream A2) exists. Schema matches
// docs/PLAN.md's "site.sqlite (contract between pipeline and app)" table —
// keep this in sync with that doc, not the other way around.
//
// Safe to re-run: refuses to touch an existing site.sqlite unless --force,
// since the moment the real pipeline output shows up this script should get
// out of its way.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', 'data');
const FORCE = process.argv.includes('--force');

const AGENCY_DIR = {
  'Environmental Protection, Dept. of': 'DEP',
  'Citywide Administrative Services, Dept. of': 'DCAS',
  'Fire Department': 'FDNY',
  'Records and Information Services, Dept. of': 'DORIS',
  'Design and Construction, Dept. of': 'DDC',
  'Buildings, Dept. of': 'DOB',
};

async function readJsonl(filePath) {
  const rows = [];
  if (!fs.existsSync(filePath)) return rows;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

async function main() {
  const siteDir = path.join(DATA_DIR, 'site');
  const dbPath = path.join(siteDir, 'site.sqlite');
  if (fs.existsSync(dbPath) && !FORCE) {
    console.log(`[fixture-site-db] ${dbPath} already exists; leaving it (pass --force to rebuild the fixture).`);
    return;
  }
  fs.mkdirSync(siteDir, { recursive: true });

  console.log('[fixture-site-db] reading data/manifest.jsonl ...');
  const manifest = await readJsonl(path.join(DATA_DIR, 'manifest.jsonl'));
  console.log(`[fixture-site-db] ${manifest.length} manifest rows`);

  let pageRows = [];
  const embedPagesPath = path.join(DATA_DIR, 'embed', 'pages.sqlite');
  if (fs.existsSync(embedPagesPath)) {
    const embed = new Database(embedPagesPath, { readonly: true });
    pageRows = embed.prepare('SELECT doc, page, bates, chars, status FROM pages').all();
    embed.close();
  }
  console.log(`[fixture-site-db] ${pageRows.length} extracted page rows from embed/pages.sqlite`);

  let topicByDoc = new Map();
  let crossByDoc = new Map();
  const relatedPath = path.join(DATA_DIR, 'embed', 'related.sqlite');
  if (fs.existsSync(relatedPath)) {
    const rcon = new Database(relatedPath, { readonly: true });
    try {
      for (const r of rcon.prepare('SELECT doc, topic FROM doc_topics').all()) topicByDoc.set(r.doc, r.topic);
    } catch {
      /* table may not exist yet */
    }
    try {
      for (const r of rcon.prepare('SELECT doc, SUM(cross) AS n FROM related GROUP BY doc').all())
        crossByDoc.set(r.doc, r.n || 0);
    } catch {
      /* table may not exist yet */
    }
    rcon.close();
  }

  // Which (doc) directories have any rendered page image, so we don't
  // fs.existsSync() 172k times for a fixture that's mostly going to be "no".
  const renderedDocs = new Set();
  const pagesRoot = path.join(DATA_DIR, 'pages');
  if (fs.existsSync(pagesRoot)) {
    for (const agencyDir of fs.readdirSync(pagesRoot)) {
      const agencyPath = path.join(pagesRoot, agencyDir);
      if (!fs.statSync(agencyPath).isDirectory()) continue;
      for (const volDir of fs.readdirSync(agencyPath)) {
        const volPath = path.join(agencyPath, volDir);
        if (!fs.statSync(volPath).isDirectory()) continue;
        for (const docDir of fs.readdirSync(volPath)) renderedDocs.add(docDir);
      }
    }
  }

  const db = new Database(dbPath.replace(/\.sqlite$/, '.sqlite.tmp'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE documents(
      doc TEXT PRIMARY KEY, bates_end TEXT, agency TEXT, source TEXT, volume TEXT, box TEXT, folder TEXT,
      page_count INTEGER, pdf_size INTEGER, status TEXT, first_seen TEXT, removed_at TEXT, reappeared_at TEXT,
      changed_at TEXT, changed_fields TEXT, held_locally INTEGER, pages_ok INTEGER, pages_empty INTEGER,
      pages_ocr INTEGER, topic INTEGER, n_related_cross INTEGER, official_url TEXT
    );
    CREATE TABLE pages(
      doc TEXT, page INTEGER, bates TEXT, chars INTEGER, ocr_status TEXT, ocr_source TEXT, image_ready INTEGER,
      PRIMARY KEY(doc, page)
    );
    CREATE TABLE snapshots(date TEXT PRIMARY KEY, documents INTEGER, pages INTEGER, bytes INTEGER, added INTEGER, removed INTEGER, changed INTEGER, sha256 TEXT);
    CREATE TABLE changes(date TEXT, doc TEXT, kind TEXT, fields TEXT);
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
  `);

  const pagesByDoc = new Map();
  for (const p of pageRows) {
    if (!pagesByDoc.has(p.doc)) pagesByDoc.set(p.doc, []);
    pagesByDoc.get(p.doc).push(p);
  }

  const insertDoc = db.prepare(`INSERT INTO documents VALUES (@doc,@bates_end,@agency,@source,@volume,@box,@folder,
    @page_count,@pdf_size,@status,@first_seen,@removed_at,@reappeared_at,@changed_at,@changed_fields,@held_locally,
    @pages_ok,@pages_empty,@pages_ocr,@topic,@n_related_cross,@official_url)`);
  const insertPage = db.prepare(
    `INSERT OR REPLACE INTO pages VALUES (@doc,@page,@bates,@chars,@ocr_status,@ocr_source,@image_ready)`,
  );

  const insertAll = db.transaction((docs) => {
    let totalPages = 0;
    for (const m of docs) {
      const pages = pagesByDoc.get(m.bates_start) || [];
      const pages_ok = pages.filter((p) => p.status === 'ok').length;
      const pages_empty = pages.filter((p) => p.status === 'empty').length;
      const pages_ocr = pages.filter((p) => p.status && p.status !== 'ok' && p.status !== 'empty').length;
      const docRendered = renderedDocs.has(m.bates_start);
      for (const p of pages) {
        insertPage.run({
          doc: p.doc,
          page: p.page,
          bates: p.bates,
          chars: p.chars ?? 0,
          ocr_status: p.status ?? null,
          ocr_source: 'city',
          image_ready: docRendered && fs.existsSync(path.join(pagesRoot, AGENCY_DIR[m.agency] || m.agency, m.production_volume, m.bates_start, `${p.page}.webp`)) ? 1 : 0,
        });
      }
      insertDoc.run({
        doc: m.bates_start,
        bates_end: m.bates_end ?? null,
        agency: m.agency ?? null,
        source: m.source ?? null,
        volume: m.production_volume ?? null,
        box: m.box_name ?? null,
        folder: m.folder_name ?? null,
        page_count: m.page_count ?? null,
        pdf_size: m.pdf_size ?? null,
        status: m.status ?? 'present',
        first_seen: m.first_seen ?? null,
        removed_at: m.removed_at ?? null,
        reappeared_at: m.reappeared_at ?? null,
        changed_at: m.changed_at ?? null,
        changed_fields: m.changed_fields ?? null,
        held_locally: fs.existsSync(path.join(process.cwd(), '..', m.local_pdf || '')) ? 1 : 0,
        pages_ok,
        pages_empty,
        pages_ocr,
        topic: topicByDoc.has(m.bates_start) ? topicByDoc.get(m.bates_start) : null,
        n_related_cross: crossByDoc.has(m.bates_start) ? crossByDoc.get(m.bates_start) : null,
        official_url: m.download_url ?? null,
      });
      totalPages += m.page_count ?? 0;
    }
    return totalPages;
  });

  console.log('[fixture-site-db] writing documents + pages ...');
  const totalPages = insertAll(manifest);

  let snapshotDate = null;
  const summaryPath = path.join(DATA_DIR, 'manifest.summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    snapshotDate = summary.catalog_snapshot?.replace(/\.csv$/, '') ?? null;
    db.prepare('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)').run(
      snapshotDate || 'unknown',
      summary.totals?.present ?? manifest.length,
      summary.totals?.pages ?? totalPages,
      summary.totals?.pdf_bytes ?? null,
      summary.totals?.present ?? manifest.length,
      0,
      0,
      summary.catalog_sha256 ?? null,
    );
  }

  const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)');
  insertMeta.run('built_at', new Date().toISOString());
  insertMeta.run('snapshot_date', snapshotDate ?? '');
  insertMeta.run('documents', String(manifest.length));
  insertMeta.run('pages', String(totalPages));
  insertMeta.run('source', 'web/scripts/fixture-site-db.mjs (dev fixture, not the real pipeline build)');

  db.close();
  fs.renameSync(dbPath.replace(/\.sqlite$/, '.sqlite.tmp'), dbPath);
  console.log(`[fixture-site-db] wrote ${dbPath} (${manifest.length} documents, ${pageRows.length} extracted pages)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
