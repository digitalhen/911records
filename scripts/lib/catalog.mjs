// catalog.mjs — the portal's catalog export, parsed, snapshotted and diffed.
//
// The whole catalog comes from ONE request: POST /api/v2/export on the Mindbreeze
// backend host (the city hostname answers 404 for that path). It returns a UTF-8
// BOM + semicolon-delimited, RFC 4180-quoted CSV (related_document holds quoted
// multi-line text). See docs/PORTAL-RECON.md §2a.
//
// Snapshots: data/catalog/<YYYY-MM-DD>.csv (America/New_York date), immutable —
// a second, DIFFERENT export on the same day is kept as <YYYY-MM-DD>T<HHMMSS>.csv,
// an identical one is reused. Each has a <stem>.summary.json (sha256, origin, stats,
// accepted/quarantined). The corpus shrinks as well as grows (PII takedowns), so
// snapshots are the record of what the city published when.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, PortalStop } from './portal.mjs';

export const EXPORT_URL = 'https://nyc.mindbreeze.com/search/september-11/api/v2/export';
export const CATALOG_DIR = join(DATA, 'catalog');
export const CSV_COLUMNS = ['Mindbreeze Key', 'Name', 'source', 'agency', 'box_name', 'folder_name', 'page_count',
  'pdf_size', 'production_volume', 'production_end', 'related_document', 'Date'];
const EXPORT_PROPS = ['mes:key', 'title', 'source', 'agency', 'box_name', 'folder_name', 'page_count', 'pdf_size',
  'production_volume', 'production_end', 'related_document', 'mes:date'];

/** Fields whose change between snapshots counts as a document change. */
export const DIFF_FIELDS = ['production_volume', 'bates_end', 'page_count', 'pdf_size', 'agency', 'source', 'box_name', 'folder_name', 'mes_key'];
/** Fields whose VALUES may be printed in reports. folder_name is hand-labelled and can carry personal names. */
const PRINTABLE = new Set(['production_volume', 'bates_end', 'page_count', 'pdf_size', 'agency', 'source', 'box_name']);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function exportCatalog(client, query = 'ALL extension:pdf') {
  const body = {
    search_request: {
      count: 100,
      properties: EXPORT_PROPS.map((name) => ({ name, formats: ['VALUE'] })),
      user: { query: { and: [{ unparsed: query, id: 'query' }] }, constraints: [] },
      source_context: { constraints: [{ unparsed: 'ALL', id: 'view_base' }] },
    },
    export_format: 'text/csv', batch_size: 1000, allow_duplicate: false, groupby_properties: [],
  };
  const t0 = Date.now();
  const res = await client.request(EXPORT_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/csv' }, body: JSON.stringify(body),
  }, { idleTimeoutMs: 180_000 });
  const chunks = [];
  try {
    for await (const chunk of res.body) { res.touch(); chunks.push(chunk); }
  } finally { res.done(); }
  const buf = Buffer.concat(chunks);
  const text = buf.toString('utf8');
  if (!res.ok) throw new Error(`export HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (/^\s*</.test(text.slice(0, 200))) throw new PortalStop(`export returned HTML (${ct}) — challenge page?`, { snippet: text.slice(0, 300) });
  if (!text.replace(/^﻿/, '').startsWith('Mindbreeze Key;Name;')) throw new Error(`export body is not the expected CSV (${ct})`);
  return { text, bytes: buf.length, seconds: +((Date.now() - t0) / 1000).toFixed(1), contentType: ct };
}

/** RFC 4180 with a configurable delimiter; quoted fields may contain delimiters, quotes ("") and newlines. */
export function parseCsv(text, delim = ';') {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && s[i + 1] === '\n') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvCell = (v) => { const t = v == null ? '' : String(v); return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** Serialize catalog rows back to the export's CSV shape (used when the catalog came from paged search). */
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(';')];
  for (const r of rows) {
    lines.push([r.mes_key, r.title, r.source, r.agency, r.box_name, r.folder_name, r.page_count, r.pdf_size,
      r.production_volume, r.bates_end, r.related_document ?? '', r.index_date].map(csvCell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const SUFFIXES = ['.pdf_MD', '.pdf.md', '_MD', '.pdf'];
/** 'NYC-WTC0003/SPDF/PDF001/NYC-WTC_000058159.pdf' -> 'NYC-WTC_000058159' (same rule as the prior art). */
export function normalizeBates(value) {
  let v = String(value ?? '').trim().split('/').at(-1);
  for (const suf of SUFFIXES) if (v.endsWith(suf)) { v = v.slice(0, -suf.length); break; }
  if (!/^NYC-WTC_\d+$/.test(v)) throw new Error(`not a Bates number: ${JSON.stringify(value)}`);
  return v;
}
export const batesNum = (b) => { const m = /(\d+)$/.exec(b ?? ''); return m ? Number(m[1]) : null; };

export function parseCatalog(text) {
  const [header, ...data] = parseCsv(text);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const c of ['Name', 'production_volume', 'pdf_size', 'page_count']) {
    if (idx[c] === undefined) throw new Error(`catalog CSV lacks column ${c}`);
  }
  const col = (r, k) => (idx[k] === undefined ? '' : (r[idx[k]] ?? '').trim());
  const num = (v) => (v === '' ? null : Number(v));
  const rows = [];
  for (const r of data) {
    if (r.length === 1 && r[0].trim() === '') continue;
    const title = col(r, 'Name');
    rows.push({
      bates_start: normalizeBates(title || col(r, 'Mindbreeze Key')),
      title,
      mes_key: col(r, 'Mindbreeze Key') || null,
      source: col(r, 'source') || null,
      agency: col(r, 'agency') || null,
      box_name: col(r, 'box_name') || null,
      folder_name: col(r, 'folder_name') || null,
      page_count: num(col(r, 'page_count')),
      pdf_size: num(col(r, 'pdf_size')),
      production_volume: col(r, 'production_volume') || null,
      bates_end: col(r, 'production_end') || null,
      related_document: col(r, 'related_document') || null,
      index_date: col(r, 'Date') || null,
    });
  }
  return { header, rows };
}

export function catalogStats(rows) {
  const tally = (field) => {
    const out = {};
    for (const r of rows) {
      const t = (out[r[field] ?? '(null)'] ??= { documents: 0, pages: 0, bytes: 0 });
      t.documents++; t.pages += r.page_count ?? 0; t.bytes += r.pdf_size ?? 0;
    }
    return Object.fromEntries(Object.entries(out).sort());
  };
  const bates = new Set(rows.map((r) => r.bates_start));
  const iv = rows.map((r) => [batesNum(r.bates_start), batesNum(r.bates_end)]).filter(([a, b]) => a != null && b != null).sort((a, b) => a[0] - b[0]);
  let gaps = 0, gapNumbers = 0, overlaps = 0;
  for (let i = 1; i < iv.length; i++) { const d = iv[i][0] - iv[i - 1][1] - 1; if (d > 0) { gaps++; gapNumbers += d; } else if (d < 0) overlaps++; }
  const sizes = rows.map((r) => r.pdf_size ?? 0).sort((a, b) => a - b);
  const pct = (p) => sizes[Math.floor(p * (sizes.length - 1))] ?? null;
  return {
    documents: rows.length,
    distinct_bates: bates.size,
    duplicates: rows.length - bates.size,
    pages: rows.reduce((s, r) => s + (r.page_count ?? 0), 0),
    pdf_bytes: rows.reduce((s, r) => s + (r.pdf_size ?? 0), 0),
    // Non-blank distinct values; the prior art counts blank as one more value (74 / 4,172 on 2026-09-13).
    boxes: new Set(rows.map((r) => r.box_name).filter(Boolean)).size,
    folders: new Set(rows.map((r) => r.folder_name).filter(Boolean)).size,
    blank_box_name: rows.filter((r) => !r.box_name).length,
    blank_folder_name: rows.filter((r) => !r.folder_name).length,
    pdf_bytes_median: pct(0.5), pdf_bytes_p99: pct(0.99), pdf_bytes_max: sizes.at(-1) ?? null,
    over_100mb: sizes.filter((x) => x > 100e6).length,
    max_pages: rows.reduce((m, r) => Math.max(m, r.page_count ?? 0), 0),
    max_bates_end: iv.reduce((m, [, b]) => Math.max(m, b), 0),
    bates_gaps: gaps, bates_gap_numbers: gapNumbers, bates_overlaps: overlaps,
    page_count_vs_bates_mismatch: rows.filter((r) => batesNum(r.bates_end) != null && r.page_count != null
      && batesNum(r.bates_end) - batesNum(r.bates_start) + 1 !== r.page_count).length,
    by_agency: tally('agency'), by_volume: tally('production_volume'), by_source: tally('source'),
  };
}

export const QUARANTINE_DROP = 0.05;
/** Reasons a snapshot must not be trusted (empty = accept). prevStats: the last accepted snapshot's stats. */
export function quarantineReasons(stats, prevStats) {
  const reasons = [];
  if (!stats.documents) reasons.push('zero rows');
  if (stats.duplicates) reasons.push(`${stats.duplicates} duplicate Bates numbers`);
  const prevDocs = prevStats?.documents;
  if (prevDocs && stats.documents < prevDocs * (1 - QUARANTINE_DROP)) {
    reasons.push(`documents fell ${prevDocs} -> ${stats.documents} (> ${QUARANTINE_DROP * 100}%)`);
  }
  return reasons;
}

const brief = (r) => ({ bates: r.bates_start, volume: r.production_volume, agency: r.agency, source: r.source,
  box_name: r.box_name, pages: r.page_count, pdf_size: r.pdf_size });

/** Diff two catalogs by Bates start. Folder labels are compared but their values never emitted. */
export function diffCatalogs(oldRows, newRows) {
  const o = new Map(oldRows.map((r) => [r.bates_start, r]));
  const n = new Map(newRows.map((r) => [r.bates_start, r]));
  const added = [...n.keys()].filter((b) => !o.has(b)).sort().map((b) => brief(n.get(b)));
  const removed = [...o.keys()].filter((b) => !n.has(b)).sort().map((b) => brief(o.get(b)));
  const changed = [];
  for (const [b, nr] of n) {
    const or = o.get(b);
    if (!or) continue;
    const fields = DIFF_FIELDS.filter((f) => (or[f] ?? null) !== (nr[f] ?? null));
    if (!fields.length) continue;
    changed.push({
      bates: b, fields,
      values: Object.fromEntries(fields.filter((f) => PRINTABLE.has(f)).map((f) => [f, { from: or[f] ?? null, to: nr[f] ?? null }])),
      page_delta: (nr.page_count ?? 0) - (or.page_count ?? 0),
      size_delta: (nr.pdf_size ?? 0) - (or.pdf_size ?? 0),
    });
  }
  const sum = (xs, k) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
  const byVolume = {};
  const bump = (v, k) => { (byVolume[v ?? '(null)'] ??= { added: 0, removed: 0, changed: 0 })[k]++; };
  added.forEach((r) => bump(r.volume, 'added'));
  removed.forEach((r) => bump(r.volume, 'removed'));
  changed.forEach((c) => bump(n.get(c.bates).production_volume, 'changed'));
  return {
    counts: {
      old_documents: oldRows.length, new_documents: newRows.length, net_documents: newRows.length - oldRows.length,
      added: added.length, removed: removed.length, changed: changed.length,
      pages_added: sum(added, 'pages'), pages_removed: sum(removed, 'pages'), pages_changed_delta: sum(changed, 'page_delta'),
      net_pages: sum(newRows, 'page_count') - sum(oldRows, 'page_count'),
      bytes_added: sum(added, 'pdf_size'), bytes_removed: sum(removed, 'pdf_size'),
    },
    by_volume: byVolume, added, removed, changed,
  };
}

// ---- snapshot store ----

const nyParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(d).map((p) => [p.type, p.value]));
export const nyDate = (d = new Date()) => { const p = nyParts(d); return `${p.year}-${p.month}-${p.day}`; };
const nyHms = (d) => { const p = nyParts(d); return `${p.hour}${p.minute}${p.second}`; };
const stem = (name) => name.replace(/\.csv$/, '');
const exists = (p) => stat(p).then(() => true, () => false);

export async function listSnapshots() {
  const files = (await readdir(CATALOG_DIR).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}.*\.csv$/.test(f)).sort();
  const out = [];
  for (const name of files) {
    const summary = JSON.parse(await readFile(join(CATALOG_DIR, `${stem(name)}.summary.json`), 'utf8').catch(() => 'null'));
    out.push({ name, path: join(CATALOG_DIR, name), date: name.slice(0, 10), sha256: summary?.sha256 ?? null, summary });
  }
  return out;
}

/** Write text as an immutable snapshot for `date`; reuse an identical same-day snapshot. */
export async function saveSnapshot(text, { date, fetchedAt = new Date() } = {}) {
  await mkdir(CATALOG_DIR, { recursive: true });
  const day = date ?? nyDate(fetchedAt);
  const digest = sha256(text);
  for (const s of await listSnapshots()) {
    if (s.date !== day) continue;
    const sDigest = s.sha256 ?? sha256(await readFile(s.path, 'utf8'));
    if (sDigest === digest) return { name: s.name, path: s.path, date: day, sha256: digest, reused: true };
  }
  let name = `${day}.csv`;
  if (await exists(join(CATALOG_DIR, name))) name = `${day}T${nyHms(fetchedAt)}.csv`;
  const path = join(CATALOG_DIR, name);
  await writeFile(`${path}.tmp`, text, { flag: 'w' });
  await rename(`${path}.tmp`, path);
  return { name, path, date: day, sha256: digest, reused: false };
}

export async function writeSnapshotSummary(name, summary) {
  const p = join(CATALOG_DIR, `${stem(name)}.summary.json`);
  await writeFile(`${p}.tmp`, JSON.stringify(summary, null, 2) + '\n');
  await rename(`${p}.tmp`, p);
}

export async function loadSnapshot(nameOrPath) {
  const path = nameOrPath.includes('/') ? nameOrPath : join(CATALOG_DIR, /\.csv$/.test(nameOrPath) ? nameOrPath : `${nameOrPath}.csv`);
  const text = await readFile(path, 'utf8');
  return { path, sha256: sha256(text), ...parseCatalog(text) };
}
